//! **The PureScript compile** — how a model's PureScript becomes something the
//! [guest](super) can evaluate.
//!
//! # The strategy, in one sentence
//!
//! A PureScript program is **compiled to JavaScript on the host** — by `purs`, against a library
//! set that was compiled once and is shipped inside gg's binary, then flattened into one ES module
//! by `esbuild` — and evaluated as a module by the [ECMAScript guest](super::super::ecmascript).
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
//! once, by `packages/gg-sandbox-purescript/build.sh`, into a 1.4 MB tarball that gg embeds — cut
//! by the same `cargo build` that compiles this file, so it cannot be a different vintage from the
//! SDK inside it. This arm's **SDK** is compiled into that same tree, which is what makes the
//! surface a model is shown in its prompt and the surface its program is compiled against one
//! artifact. It could have gone in the image beside `purs` and it deliberately does not: gg is copied
//! as a single file into an ephemeral run container whose image was built separately, so a tree that
//! lived in the image could be a different vintage from the binary reading it. Once this arm's SDK
//! is compiled into that tree, that would mean a model being shown one surface in its prompt and
//! compiled against another.
//!
//! # What a PureScript program costs to compile
//!
//! Measured in this repository's dev container, aarch64, against the embedded tree (329 modules,
//! 50 packages plus this arm's own SDK), median of nine:
//!
//! | | |
//! | --- | --- |
//! | Hard-linking the tree into this preparation's workspace (1,430 files) | ~27 ms |
//! | `purs compile` — dominated by loading 9 MB of externs, not by the program | ~205 ms |
//! | `esbuild` — bundling, tree-shaking and composing the source maps | ~58 ms |
//! | End to end | **~298 ms** |
//!
//! The feasibility study priced this arm at 0.45–0.65 s per turn with a `purs ide server` needed to
//! bring it to 151–713 ms. It is cheaper than that here, and the difference is the staging: a real
//! `cp -a` of the tree costs ~150 ms where a hard-linked one costs ~27 ms, and the study's figure
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
//!    [shared toolchain directory](crate::sandbox::shared_toolchain_dir) through [`place_tree`],
//!    which renames a finished tree into place and seals every file and directory in it read-only.
//! 2. **Each preparation compiles in its own tree**, hard-linked from that one in ~27 ms. Hard links
//!    are what make a private tree affordable — and they are also what makes the sealing bite, since
//!    a link to a read-only inode is read-only too. The two files `purs` rewrites whatever else it
//!    does are the ones at the root of `output/`, and those are staged as real copies; every other
//!    file in the tree stays linked and stays sealed. The seal is what found the second of the two — left linked,
//!    the compile failed with `Permission denied` naming `output/package.json` rather than writing
//!    through into every other agent's tree.
//! 3. **The spawn goes through [`PrepareContext::compiler`]**, so the working directory, `HOME`,
//!    `TMPDIR` and the `XDG_*` roots are inside that private tree — which is what covers whatever
//!    `purs` and `esbuild` write that this module never thought about.
//!
//! It is **verified by mutation** rather than only by passing. Pointed at one shared output tree —
//! the measured shape — the seam's own isolation gate (`language/isolation.rs`) failed this arm
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
//! | a diagnostic in a code module and none in the program | [`PrepareFailure::Lowering`] — the module compiled on its own when it was loaded, so this is gg's |
//! | `purs` or `esbuild` could not run, was killed, or reported nothing | [`PrepareFailure::Toolchain`] — **not** the model's, and never shown to it as its own |
//! | the `purs` on `PATH` is not the release the shipped tree was compiled by | [`PrepareFailure::Toolchain`], refused by [`agree_on_the_compiler`] at the first compile of the process, naming both releases — because externs are a compiler-version-private format and the alternative is every program failing over gg's own library files |
//!
//! Diagnostics are located in the model's **own** coordinates, because the file `purs` reads is the
//! reply and nothing else: the model declares its own module header and its own `main`, and nothing
//! here reads that header or replaces it. A reply with no header is `ErrorParsingModule` at line 1,
//! which is the compiler's own answer to the compiler's own question.
//!
//! # Where the entry point comes from
//!
//! `esbuild` is pointed at a generated module that imports `main` from the JavaScript `purs` emitted
//! for the response, and `purs` files a module's emitted JavaScript under the module's own name. So
//! the entry point needs that name — and it is [read out of the output tree](response_module) rather
//! than out of the reply. The library set is shipped pre-compiled and hard-linked into the workspace,
//! and every loaded code module was compiled into the same project under `Lib.<Key>`, so the module
//! directory neither of them claims is the response's.
//!
//! What makes that answer unambiguous across an agent's turns is [the
//! sweep](clear_previous_response): the output directory is [persistent work](PROJECT_DIRS) and
//! survives the reset the next preparation pays, so every unclaimed directory in it is removed
//! before `purs` runs. A module name a response reuses from an earlier response therefore resolves
//! to this response's own build, and a name colliding with a library module or with a loaded one is
//! `DuplicateModule` in the model's own file before any of this is asked.
//!
//! A code module's are its author's, on the same terms. The one thing gg writes into that file is
//! the module's name, [replaced inside the header line its author wrote](headed), so a module is
//! `Lib.<Key>` to every program that imports it and every diagnostic is still at the line it was
//! written on.
//!
//! A **run-time** location travels the other way, through the source map `purs` and `esbuild` both
//! emit and gg composes — see [`locations`](crate::sandbox::ProgramLanguage::locations).

use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Deserialize;

use crate::sandbox::language::compile::{
    CompilerReport, Workspace, place_tree, shared_toolchain_dir,
};
use crate::sandbox::language::{
    CodeModule, PrepareContext, PrepareError, PrepareFailure, PreparedProgram,
};

/// The library set, compiled: every package's PureScript sources beside the externs and JavaScript
/// `purs` emitted for them — **and this arm's own SDK**, staged into the same tree and compiled with
/// them — as one gzipped tar built by `packages/gg-sandbox-purescript/build.sh`.
///
/// Embedded for the reason the guest components are: gg is copied as a single file into an ephemeral
/// run container and must carry everything it needs with it.
const LIBRARIES_TAR_GZ: &[u8] = include_bytes!(concat!(
    env!("GG_ARTIFACTS_PURESCRIPT"),
    "/purescript.libraries.tar.gz"
));

/// What that tree was built from and what is in it.
const MANIFEST_JSON: &str = include_str!(concat!(
    env!("GG_ARTIFACTS_PURESCRIPT"),
    "/purescript.compiler.json"
));

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

/// How long `purs --version` may take. It reads no files and prints one line.
const VERSION_TIMEOUT: Duration = Duration::from_secs(30);

/// The file a program is compiled under, and the one its diagnostics are located in.
pub(super) const PROGRAM_FILE: &str = "program.purs";

/// The entry module `esbuild` is pointed at.
///
/// One of the sources in the bundle that are gg's rather than the model's or a library's, which
/// `PureScript::locations` strikes the frames of. The rest are this arm's SDK, named by
/// [`ggs_own_sources`].
pub(super) const ENTRY_FILE: &str = "entry.js";

/// The namespace this arm's SDK declares every one of its modules under.
const SDK_NAMESPACE: &str = "Gg";

/// What the bundler writes, beside the model's own source in this preparation's working directory.
///
/// Beside it rather than in the workspace's output directory because a source map's `sources` are
/// relative to the file carrying it: written here, a frame in the model's own PureScript reads
/// `program.purs:11:27` and one in a library reads that library's own path, where a bundle written
/// a directory away would name both through a `../`.
const BUNDLE_FILE: &str = "bundle.js";

/// The glob that names the library set's sources to `purs`.
///
/// One argument rather than 49, and `libs/*/src/**` rather than `libs/**`: the two find the same 309
/// modules, and the narrower one is measurably cheaper to walk.
const LIBRARY_GLOB: &str = "libs/*/src/**/*.purs";

/// The compiled half of the tree — and the only part of it `purs` writes into.
const OUTPUT_DIR: &str = "output";

/// The tree's two top-level directories: the library sources, and what `purs` compiled them to.
const TREE_DIRS: [&str; 2] = ["libs", OUTPUT_DIR];

/// **The `purs` project's own directories**, which the agent's compile workspace keeps across its
/// preparations rather than emptying with the rest of the working directory.
///
/// The same two, declared to the seam through
/// [`persistent_work`](crate::sandbox::ProgramLanguage::persistent_work). `purs` is given a project
/// directory and keys its own incremental work on what is in it, so re-staging it per preparation
/// would both cost 1,430 links a turn and throw away the compiler's record of what it had already
/// built — including the code modules this agent loaded.
pub(super) const PROJECT_DIRS: &[&str] = &TREE_DIRS;

/// What the embedded library tree was built from, and what is in it.
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
    /// filed among them would be a package no package set has ever heard of. It is also the name a
    /// source map gives an SDK frame, which is how [`ggs_own_sources`] knows one.
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
            .expect("the embedded compiler manifest is valid JSON of the expected shape")
    })
}

/// The `purs` release a program is compiled with, for the run's own record and for an operator
/// reading a diagnostic and wondering whose it is.
pub(super) fn compiler_version() -> &'static str {
    &manifest().purs
}

/// Unpack the library tree now, so the first compile does not.
///
/// The whole of this language's warm-up: ~1.4 MB decompressed into 1,430 files, once per machine.
/// The result is dropped, because a failure here is the failure the first compile will make, and
/// there it is classified, counted and reported.
pub(super) fn warm() {
    let _ = libraries();
}

/// Compile a **program** — a model's reply — into the JavaScript module the guest evaluates, with
/// every code module this turn carries compiled beside it.
///
/// The modules are files of the same `purs` project, so `Lib.CsvTools` is a module the program
/// imports and `purs` type-checks the call against the author's own signature. Nothing is written
/// around the reply to reach one: the program carries its own `import Lib.CsvTools as CsvTools`, the
/// way it carries every other line it needs.
pub(super) fn compile_program(
    source: &str,
    modules: &[CodeModule],
    context: &PrepareContext,
) -> Result<PreparedProgram, PrepareFailure> {
    let workspace = staged(context)?;
    let claimed = claimed_modules(modules).map_err(PrepareFailure::Toolchain)?;
    clear_previous_response(workspace, &claimed).map_err(PrepareFailure::Toolchain)?;

    workspace
        .write(PROGRAM_FILE, source)
        .map_err(PrepareFailure::Toolchain)?;
    let mut files = vec![PROGRAM_FILE.to_string()];
    // Each module was compiled into this project at the read that loaded it, so `purs` finds its
    // file unchanged and its output up to date and compiles the response alone. One this agent's
    // workspace holds no build of is written now and compiled with the program, and recorded so the
    // program after it does not.
    let mut fresh: Vec<&CodeModule> = Vec::new();
    for module in modules {
        files.push(module_path(workspace, &module.name));
        if workspace
            .module_build(&module.name, &module.source)
            .is_none()
        {
            write_module(workspace, &module.name, &module.source)?;
            fresh.push(module);
        }
    }

    let report = invoke_purs(&files, context).map_err(PrepareFailure::Toolchain)?;
    classify(&report, PROGRAM_FILE, modules)?;
    for module in fresh {
        record_module(workspace, &module.name, &module.source);
    }

    // Asked AFTER `purs` accepted the source, so a reply the compiler refused is answered by its own
    // diagnostic rather than by a missing directory here.
    let module = response_module(workspace, &claimed)?;
    workspace
        .write(ENTRY_FILE, &entry_source(&module))
        .map_err(PrepareFailure::Toolchain)?;

    let report = invoke_esbuild(context).map_err(PrepareFailure::Toolchain)?;
    classify_bundle(&report, &module)?;

    let bundle = workspace.work().join(BUNDLE_FILE);
    let source = std::fs::read_to_string(&bundle).map_err(|error| {
        PrepareFailure::Toolchain(format!(
            "esbuild {} reported success but wrote no JavaScript to {}: {error}",
            manifest().esbuild,
            bundle.display(),
        ))
    })?;
    Ok(PreparedProgram {
        source,
        component: None,
    })
}

/// Compile a **code module** — the code half of a [skill](crate::skills) or a
/// [memory](crate::memories) — into the agent's `purs` project, under the name a program imports it
/// by.
///
/// This is where a module is compiled and the only place. `key` is the binding key, so the file is
/// headed `Lib.<Key>` and written into that key's directory in the
/// [band](crate::sandbox::Workspace::open_module), and `purs` compiles it into the project's own
/// `output/Lib.<Key>`. Both survive the preparation, so every program the agent writes afterwards
/// lists the same file and `purs` finds it up to date.
///
/// Compiling it here is what puts an author's mistake at the use that loaded it rather than in front
/// of the next program that has it in scope.
pub(super) fn compile_module(
    key: &str,
    source: &str,
    context: &PrepareContext,
) -> Result<(), PrepareFailure> {
    let workspace = staged(context)?;
    let file = write_module(workspace, key, source)?;
    let report = invoke_purs(&[file], context).map_err(PrepareFailure::Toolchain)?;
    classify(&report, &module_file(key), &[])?;
    record_module(workspace, key, source);
    Ok(())
}

/// Write one code module's headed source into its own directory in the band, and hand back the path
/// `purs` is given.
fn write_module(workspace: &Workspace, key: &str, source: &str) -> Result<String, PrepareFailure> {
    workspace
        .open_module(key)
        .map_err(PrepareFailure::Toolchain)?;
    workspace
        .write_module(
            key,
            &module_file(key),
            &headed(source, &super::module_path(key)),
        )
        .map_err(PrepareFailure::Toolchain)?;
    Ok(module_path(workspace, key))
}

/// Record that the module bound at `key` is compiled into this project — its file, and what `purs`
/// emitted for it.
fn record_module(workspace: &Workspace, key: &str, source: &str) {
    let emitted = workspace
        .work()
        .join(OUTPUT_DIR)
        .join(super::module_path(key));
    workspace.record_module(
        key,
        source,
        vec![workspace.work().join(module_path(workspace, key)), emitted],
    );
}

/// The agent's `purs` project, with the library set hard-linked into it and the compiler agreed
/// with — everything every compile here needs before it writes a source file.
///
/// The staging happens **once for the agent** rather than once per preparation, which is what
/// [`PROJECT_DIRS`] is declared for: `purs` keys its own incremental work on the project directory,
/// so a tree re-linked every turn is a compiler told nothing it built is still there.
fn staged(context: &PrepareContext) -> Result<&Workspace, PrepareFailure> {
    let libraries = libraries().map_err(PrepareFailure::Toolchain)?;
    let workspace = context.workspace().map_err(PrepareFailure::Toolchain)?;
    agree_on_the_compiler(context)?;
    workspace
        .stage_once(PROJECT_DIRS, || stage(workspace.work(), libraries))
        .map_err(PrepareFailure::Toolchain)?;
    Ok(workspace)
}

/// The file one code module is compiled under.
///
/// Named for the module it declares, so a run-time frame the composed source map resolves into an
/// author's own code reads `Lib.CsvTools.purs`. It is also what tells a diagnostic in a module from
/// one in the shipped library tree, which is a comparison on the file's name — so the name has to be
/// one no library file has, and `Lib.<Key>.purs` is.
fn module_file(key: &str) -> String {
    format!("{}.purs", super::module_path(key))
}

/// Where that file is, as `purs` is given it: inside the key's own directory in the band, relative to
/// the working directory the compiler runs in.
fn module_path(workspace: &Workspace, key: &str) -> String {
    workspace.module_path(key, &module_file(key))
}

/// `source` with the name in its module header replaced by `name`.
///
/// The one thing gg writes into an author's file, and it is [the wrap a code module
/// allows](https://docs.testcabinet.ai/gg/responses-as-code/invariants/): the module a program
/// imports is `Lib.<Key>`, which is gg's to decide because the key is, and the author cannot know
/// the key their skill will be bound under. It **adds no line** — the replacement happens inside the
/// header the author wrote — so every diagnostic `purs` reports is at the line its author wrote.
///
/// The header is found through [the arm's own scanner](super::modules::header_name_span), over
/// [the code mask](super::mask) — the one that already reads a module's header for the export list
/// it carries, so the name gg compiles a module under and the names gg reports it offers are read
/// out of one reading of the same header.
///
/// A source with no header is handed over untouched, and `purs` answers `ErrorParsingModule` at
/// line 1, which is the compiler's own answer to the compiler's own question.
fn headed(source: &str, name: &str) -> String {
    let mask = super::mask::code_mask(source);
    match super::modules::header_name_span(source, mask.as_ref()) {
        Some(span) => format!("{}{name}{}", &source[..span.start], &source[span.end..]),
        None => source.to_string(),
    }
}

/// The JavaScript entry module `esbuild` is pointed at, for a program whose own module is called
/// `module`.
///
/// It is gg's, and it names exactly one thing: the entry point the model declared. `main` is
/// imported by name rather than through the namespace so that a program with no entry point is
/// refused by the bundler, with a diagnostic, instead of failing inside the guest as an ordinary
/// `TypeError` on `undefined`. Whatever code modules the program imported are already in the module
/// graph `purs` emitted, reached from the program's own `import` line.
fn entry_source(module: &str) -> String {
    let target = format!("./{OUTPUT_DIR}/{module}/index.js");
    format!("import {{ main }} from {target:?};\n\nmain();\n")
}

/// **The prefixes of the composed map's source names that are gg's own**, whose frames the model
/// reads a count of rather than a location in.
///
/// Three, because gg's code reaches the bundle by three routes. `esbuild`'s entry module is gg's own
/// file. The SDK's PureScript is staged under `libs/` beside the registry packages, so `purs` maps
/// an SDK frame to a path under the directory the manifest records the SDK's own name as. The SDK's
/// foreign JavaScript is copied rather than compiled, so `purs` writes no mapping for it and it
/// reaches the map under the output directory `purs` filed the module in.
///
/// The output prefix carries the namespace rather than being the output directory alone: a frame in
/// a *library's* foreign JavaScript arrives the same way and names code the model's program really
/// was compiled against, so it is reported.
pub(super) fn ggs_own_sources() -> Vec<String> {
    vec![
        ENTRY_FILE.to_string(),
        format!("libs/{}/", manifest().sdk),
        format!("{OUTPUT_DIR}/{SDK_NAMESPACE}."),
    ]
}

// ---------------------------------------------------------------------------------------------
// The response's own module
// ---------------------------------------------------------------------------------------------

/// **Every module directory the shipped library set already claims**, read once per process.
///
/// Read from the sealed shared tree rather than from an agent's copy of it, which is what makes it a
/// per-process constant: the tree is content-keyed, placed once per machine and read-only from then
/// on, so every agent's hard-linked copy carries exactly these directories and nothing else could
/// have put one there.
fn library_modules() -> Result<&'static std::collections::BTreeSet<String>, String> {
    static MODULES: std::sync::OnceLock<Result<std::collections::BTreeSet<String>, String>> =
        std::sync::OnceLock::new();
    MODULES
        .get_or_init(|| directories(&libraries()?.tree.join(OUTPUT_DIR)))
        .as_ref()
        .map_err(Clone::clone)
}

/// Every module directory in `output` that is **not** this response's: the shipped library set's,
/// and one per code module this turn carries.
///
/// A loaded module is claimed by the turn's own list rather than by what the workspace has built,
/// because that list is what `purs` is about to be given. A key the turn no longer carries is a key
/// no program can import, so its build is the previous response's leavings and goes with them.
fn claimed_modules(modules: &[CodeModule]) -> Result<std::collections::BTreeSet<String>, String> {
    let mut claimed = library_modules()?.clone();
    claimed.extend(
        modules
            .iter()
            .map(|module| super::module_path(&module.name)),
    );
    Ok(claimed)
}

/// **Remove the previous response's build output**, so that what `purs` writes for this one is the
/// only unclaimed module directory in the tree.
///
/// The output directory is [persistent work](PROJECT_DIRS) — `purs` keys its incremental work on it
/// and the loaded modules' builds live in it — so the reset a preparation pays leaves it standing,
/// and the module directory the previous response's header named is still there. Removing it is what
/// makes [`response_module`] an answer rather than a guess, and it is what lets a model reuse a
/// module name it used a turn ago.
///
/// Only directories are considered. The two files at the root of `output/` are `purs`'s own
/// bookkeeping, and an entry in `cache-db.json` for a module whose directory is gone is inert:
/// `purs` rebuilds a module whose output it cannot find whatever it believes about the source.
fn clear_previous_response(
    workspace: &Workspace,
    claimed: &std::collections::BTreeSet<String>,
) -> Result<(), String> {
    let output = workspace.work().join(OUTPUT_DIR);
    for name in directories(&output)? {
        if claimed.contains(&name) {
            continue;
        }
        let path = output.join(&name);
        std::fs::remove_dir_all(&path)
            .map_err(|error| format!("could not clear {}: {error}", path.display()))?;
    }
    Ok(())
}

/// **The module `purs` filed this response under** — the one directory in the compiler's output that
/// neither the library set nor a loaded code module claims.
///
/// The name is the model's, written in its own header, and nothing here reads that header: `purs`
/// has already read it, accepted it and filed the emitted JavaScript under it. Asked after the
/// compile succeeded, so a program the compiler refused never reaches this.
///
/// Both ways of failing are gg's rather than the model's, and are reported as such. A collision with
/// a module of any other name is impossible here: `purs` answers two modules of one name with
/// `DuplicateModule` against the first file it was given, which is always the program's.
fn response_module(
    workspace: &Workspace,
    claimed: &std::collections::BTreeSet<String>,
) -> Result<String, PrepareFailure> {
    let output = workspace.work().join(OUTPUT_DIR);
    let mut unclaimed: Vec<String> = directories(&output)
        .map_err(PrepareFailure::Toolchain)?
        .into_iter()
        .filter(|name| !claimed.contains(name))
        .collect();
    match unclaimed.len() {
        1 => Ok(unclaimed.remove(0)),
        0 => Err(PrepareFailure::Toolchain(format!(
            "purs {} compiled {PROGRAM_FILE} and wrote no module of its own into {}",
            compiler_version(),
            output.display(),
        ))),
        _ => Err(PrepareFailure::Toolchain(format!(
            "purs {} compiled {PROGRAM_FILE} and gg cannot tell which of {unclaimed:?} in {} is the \
             response's own module",
            compiler_version(),
            output.display(),
        ))),
    }
}

/// The names of the directories directly inside `path`, which for `output/` is one per compiled
/// module.
fn directories(path: &Path) -> Result<std::collections::BTreeSet<String>, String> {
    let entries = std::fs::read_dir(path)
        .map_err(|error| format!("could not read {}: {error}", path.display()))?;
    let mut names = std::collections::BTreeSet::new();
    for entry in entries {
        let entry = entry.map_err(|error| format!("could not read {}: {error}", path.display()))?;
        if entry.file_type().is_ok_and(|kind| kind.is_dir()) {
            names.insert(entry.file_name().to_string_lossy().into_owned());
        }
    }
    Ok(names)
}

// ---------------------------------------------------------------------------------------------
// The two invocations
// ---------------------------------------------------------------------------------------------

/// Refuse, once per process, a `purs` that is not the release the embedded tree was compiled by.
///
/// Externs are a **compiler-version-private format**, so this is not a nicety: a `purs` that drifted
/// from the manifest's pin cannot read the tree gg ships, and every compile fails with diagnostics
/// in gg's own library files. [`classify`] already routes that to
/// [`Toolchain`](PrepareFailure::Toolchain) rather than blaming the model — the band is right — but
/// what an operator would read is *purs reported no diagnostic in the program*, which names neither
/// the cause nor the fix. This makes the first compile of the process say both instead.
///
/// The check is here rather than in [`warm`] because a compiler runs on
/// [a preparation's own ground](crate::sandbox::language::compile) and a preparation is the only
/// thing that owns one — the seam mints a [`PrepareContext`] per preparation and a language may only
/// receive one. So the cost lands where every other compile cost on this arm lands: inside the turn's
/// [compile measurement](crate::sandbox::SandboxOutcome::compile), once, at about ten milliseconds,
/// and never again for the life of the process.
fn agree_on_the_compiler(context: &PrepareContext) -> Result<(), PrepareFailure> {
    static AGREED: std::sync::OnceLock<Result<(), String>> = std::sync::OnceLock::new();
    AGREED
        .get_or_init(|| check_purs_version(context))
        .clone()
        .map_err(PrepareFailure::Toolchain)
}

/// Ask `purs` what it is, and compare it with the manifest's pin.
///
/// A version that cannot be *read* is not a mismatch and is not refused here: `--version` failing
/// while `compile` would have worked is a strange machine rather than a wrong one, and the compile
/// that follows reports whatever is really wrong with far more to go on. Only a version that reads
/// cleanly and disagrees is fatal.
fn check_purs_version(context: &PrepareContext) -> Result<(), String> {
    let purs = tool(PURS_ENV, "purs");
    let Ok(mut command) = context.compiler(&purs) else {
        return Ok(());
    };
    let Ok(report) = command.arg("--version").run(VERSION_TIMEOUT) else {
        return Ok(());
    };
    if !report.ok {
        return Ok(());
    }
    // `purs --version` prints the release and nothing else; a build that decorated it would still
    // carry it as the first token.
    version_verdict(
        report.stdout.split_whitespace().next().unwrap_or_default(),
        &purs,
    )
}

/// What an observed `purs` release means, given the one the tree was compiled by.
///
/// Split out from the invocation so both answers are testable without a second compiler on the
/// machine: an empty reading is a `--version` this parse did not understand and is not a mismatch.
fn version_verdict(observed: &str, purs: &str) -> Result<(), String> {
    if observed.is_empty() || observed == compiler_version() {
        return Ok(());
    }
    Err(format!(
        "gg's PureScript library tree was compiled by purs {} and `{purs}` reports {observed} \
         (install the pinned release with containers/gg-toolchains, from \
         packages/gg-sandbox-purescript/purescript-version.sh, or point {PURS_ENV} at it)",
        compiler_version(),
    ))
}

/// Spawn `purs` over the sources in this preparation's own workspace and wait for it, killing it at
/// [`COMPILE_TIMEOUT`].
///
/// `files` is the program and every code module beside it, which is what makes a module a module of
/// the program's own project rather than something compiled elsewhere and looked up by name.
fn invoke_purs(files: &[String], context: &PrepareContext) -> Result<CompilerReport, String> {
    let purs = tool(PURS_ENV, "purs");
    context
        .compiler(&purs)
        .map_err(|error| format!("{}{error}", spawn_prefix(&purs, PURS_ENV)))?
        .arg("compile")
        // Structured diagnostics on stdout: an error's own code and its exact span, rather than
        // prose gg would have to scrape a location out of.
        .arg("--json-errors")
        // The map that reads a frame in the bundle back into the PureScript it was compiled from.
        // `esbuild` follows the `sourceMappingURL` comment `purs` writes and composes the two, and
        // `crates/gg/src/sandbox/locate.rs` reads the composition with a standard library — which is
        // the only means the invariants allow a location to be recovered by.
        //
        // The shipped library tree is compiled with the same codegen set
        // (`packages/gg-sandbox-purescript/build.sh`). A tree without the maps is a tree every
        // program's compile finds stale, which is ~2.9 s instead of ~200 ms.
        .arg("--codegen")
        .arg("js,sourcemaps")
        // Relative to the working directory, which is this preparation's own — so this is the
        // hard-linked tree and nothing else can see it.
        .arg("--output")
        .arg(OUTPUT_DIR)
        .args(files)
        .arg(LIBRARY_GLOB)
        .run(COMPILE_TIMEOUT)
        .map_err(|error| match error.starts_with("could not run") {
            true => format!("{}{error}", spawn_prefix(&purs, PURS_ENV)),
            false => error,
        })
}

/// Spawn `esbuild` over what `purs` emitted, writing [`BUNDLE_FILE`] into the working directory.
fn invoke_esbuild(context: &PrepareContext) -> Result<CompilerReport, String> {
    let esbuild = tool(ESBUILD_ENV, "esbuild");
    let mut command = context
        .compiler(&esbuild)
        .map_err(|error| format!("{}{error}", spawn_prefix(&esbuild, ESBUILD_ENV)))?;
    command
        .arg(ENTRY_FILE)
        .arg("--bundle")
        // The guest declares what comes out of here as a module, so what comes out of here is a
        // module: the two `import` lines below survive into it and the guest's own loader resolves
        // them.
        .arg("--format=esm")
        // gg's SDK, which the bridge in `Gg/Internal/Wire.js` imports. Left to the guest so that a
        // program and the SDK share one instance, and therefore one `ApiError` class.
        .arg("--external:gg")
        // The map, inline, so it travels wherever the source does — see
        // [`locations`](crate::sandbox::ProgramLanguage::locations).
        .arg("--sourcemap=inline")
        .arg(format!("--outfile={BUNDLE_FILE}"))
        // Warnings are the bundler's opinion about generated code and reach nobody; errors are read
        // from stderr either way.
        .arg("--log-level=warning");
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
        "gg found no PureScript toolchain (`{tool}` on PATH, in {TOOLCHAIN_BIN}, or named by \
         {variable}): "
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

/// How many of `purs`'s diagnostics a model is shown.
///
/// [Kotlin's eight](super::super::kotlin), with one thing to say about the measurement behind it.
/// The eight-arm measurement — one misremembered SDK name called at fifty call sites — puts this arm
/// at 3139 bytes across 149 lines: ~63 bytes and ~3 lines a diagnostic, which would make eight of
/// them ~500 bytes and this the cheapest uncapped arm of the eight. **That is a floor rather than a
/// typical case.** It is what an `UnknownName` costs, which is about the shortest thing `purs` says;
/// the compiler's ordinary output is multi-paragraph prose it has already wrapped and indented — a
/// `TypesDoNotUnify` prints both types in full under `while trying to match type … with type …`, and
/// then the expression it was checking. So this bounds a tail whose per-item cost the measurement
/// understates rather than overstates, and the ~500 bytes is the least eight of them can be.
///
/// Eight and not fewer, because `purs` reports one error per *site* and a model fixing a surface
/// mistake wants the list of places to fix it, not one place and a number.
///
/// It bounds what the model **reads** and never what a [band](classify) is decided on: whether any
/// diagnostic is in the model's own file at all, and whether one of them is a parse failure, are
/// both settled over the whole set first.
const SHOWN: usize = 8;

/// Turn a finished `purs` invocation into a verdict.
///
/// `file` is the source whose diagnostics are the model's, or the author's on the check of a module
/// alone. `modules` is what else was compiled beside it, so a diagnostic in one of those is reported
/// as [gg's own](PrepareFailure::Lowering) rather than as the model's: every module compiled on its
/// own when the skill carrying it was used, so one that fails here failed at gg's hands.
fn classify(
    report: &CompilerReport,
    file: &str,
    modules: &[CodeModule],
) -> Result<(), PrepareFailure> {
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
        let broken = modules.iter().find(|module| {
            let file = module_file(&module.name);
            diagnostics
                .errors
                .iter()
                .any(|diagnostic| diagnostic.is_from(&file))
        });
        if let Some(module) = broken {
            let file = module_file(&module.name);
            let rendered = crate::sandbox::language::diagnostics::capped(
                diagnostics
                    .errors
                    .iter()
                    .filter(|diagnostic| diagnostic.is_from(&file))
                    .map(|diagnostic| diagnostic.render(&file))
                    .collect(),
                SHOWN,
                "\n\n",
            );
            return Err(PrepareFailure::Lowering(format!(
                "purs {} refused the code module gg compiled as `{}` beside the program, which \
                 compiled on its own when it was loaded:\n{rendered}",
                compiler_version(),
                super::module_path(&module.name),
            )));
        }
        return Err(PrepareFailure::Toolchain(format!(
            "purs {} {} without reporting a diagnostic in the program{}",
            compiler_version(),
            report.status,
            report.stderr_tail(),
        )));
    }

    // Deduplicated and capped through the seam's own [bound](SHOWN), because `purs` reports one
    // error per site: a name the SDK does not have is a separate `UnknownName` at every place the
    // program used it, each carrying the same paragraph of prose.
    let rendered = crate::sandbox::language::diagnostics::capped(
        mine.iter()
            .map(|diagnostic| diagnostic.render(file))
            .collect(),
        SHOWN,
        "\n\n",
    );
    // A parse failure anywhere is the whole verdict: the compiler never got as far as meaning, so
    // whatever else it says is downstream of text it could not read. Asked of `mine` — every
    // diagnostic in the model's own file — rather than of the bounded rendering, so a parse error
    // the cap did not show still decides the band it belongs to.
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
    /// The coordinate is `purs`'s own, against the file gg wrote the reply into unchanged, so it
    /// names the line of the reply the model actually wrote.
    fn render(&self, file: &str) -> String {
        let located = match &self.position {
            Some(position) => format!(
                "{file}:{}:{}: {}",
                position.start_line, position.start_column, self.error_code,
            ),
            None => format!("{file}: {}", self.error_code),
        };
        format!("{located}\n{}", self.message.trim_end())
    }
}

/// What `esbuild` says when the entry module asks for an export the program does not have — which
/// for this arm means one thing: no `main`.
const NO_ENTRY_POINT: &str = "No matching export";

/// What `esbuild` says when the entry module names a file that is not there.
const NO_SUCH_MODULE: &str = "Could not resolve";

/// Turn a finished `esbuild` invocation into a verdict.
///
/// Only one of its failures is the model's, and it is a real one: a program that compiled cleanly but
/// declares no `main` has nothing to run, and the model is told that in a sentence rather than being
/// shown a bundler's error about a JavaScript file it never wrote.
///
/// The one below it is gg's: the entry point names the module directory
/// [`response_module`] identified in `purs`'s own output, so a specifier that does not resolve means
/// the directory it named is not the one holding the response's JavaScript. That is this file's
/// defect and is reported as one.
fn classify_bundle(report: &CompilerReport, module: &str) -> Result<(), PrepareFailure> {
    if report.ok {
        return Ok(());
    }
    if report.stderr.contains(NO_ENTRY_POINT) {
        return Err(PrepareFailure::Program(PrepareError::Compile(
            "the program has no entry point: it must define `main :: Effect Unit`, and export \
             it if its `module … (…) where` header lists its exports"
                .to_string(),
        )));
    }
    if report.stderr.contains(NO_SUCH_MODULE) {
        return Err(PrepareFailure::Toolchain(format!(
            "purs {} compiled the program and gg identified its module as {module:?}, which \
             esbuild could not resolve{}",
            compiler_version(),
            report.stderr_tail(),
        )));
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
/// Unpacking is ~1.4 MB decompressed into 1,430 files and happens once per machine, not once per
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

/// Unpack the embedded tree into a [shared toolchain directory](shared_toolchain_dir).
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

/// Decompress and extract the embedded tarball into `into`.
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

/// A stable digest of the embedded tarball, so a change to it changes the directory it is unpacked
/// into. Not cryptographic and not required to be: it distinguishes builds, it does not defend
/// against one.
fn fingerprint() -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    LIBRARIES_TAR_GZ.hash(&mut hasher);
    hasher.finish()
}

/// Give this preparation its own copy of the library tree, inside `work`.
///
/// Hard links rather than copies: 1,430 files land in ~27 ms instead of ~150 ms, and — because a hard
/// link shares the inode, and the shared tree's inodes are sealed read-only — a compiler that tried to
/// rewrite a library's artifact would be refused rather than corrupting every other agent's tree. The
/// directories are made fresh, so `purs` can create the one directory it needs (the program's own
/// module) inside them, and so the whole tree unlinks cleanly when the workspace is dropped.
///
/// The exception is the files at the **root** of `output/`, which `purs` rewrites on every compile
/// however little it recompiled: `cache-db.json` (what it believes is up to date) and `package.json`
/// (the `{"type": "module"}` that makes its emitted `.js` files ES modules). Those are staged as real,
/// writable copies. Every other file in the tree stays linked and stays sealed — and the
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

/// **The modules `purs` said this program could not import**, read out of the rendering
/// [`Diagnostic::render`](Diagnostic::render) produced.
///
/// `purs` reports one sentence for it, under the `ModuleNotFound` code this arm renders above it:
/// `Module Data.Argonaut was not found.` The module name is unquoted and the sentence is what
/// bounds it.
pub(super) fn unresolved_imports(diagnostic: &str) -> Vec<String> {
    diagnostic
        .lines()
        .flat_map(|line| {
            crate::sandbox::language::diagnostics::named(line, "Module ", " was not found")
        })
        .collect()
}

#[cfg(test)]
#[path = "purescript.compile.test.rs"]
mod tests;
