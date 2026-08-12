//! Reflect every program language's signature catalogue out of its own SDK, as a step of building
//! this crate, and hand the eleven JSON files to `OUT_DIR` for the arm modules to `include_str!` —
//! and tell those same modules where each arm's **artifacts** were built.
//!
//! # Two halves, one subject
//!
//! An arm of gg's responses-as-code capability is two things that must agree: what a model is
//! **told** it can call, and what its program is actually compiled and evaluated **against**. This
//! file is where both stop being committed files and become outputs of the build that embeds them.
//!
//! * The **catalogue** — the description — is reflected here, by running
//!   `scripts/gg-signatures.sh`. That is the bulk of this file and the whole of the argument below.
//! * The **artifacts** — the bytes: an SDK jar, a compiler, a baked guest component — are built one
//!   crate per arm, under `crates/gg-sandbox-artifacts/`, and this file only re-publishes where they
//!   landed. They are separate crates rather than more steps here because a build script has one
//!   rerun set: folded in, editing a Python docstring would re-run `swiftc`. See
//!   `gg-artifact-build`'s header for that argument in full, and [`publish_artifact_roots`] for the
//!   part of it that lives here.
//!
//! # Why these are built and not committed
//!
//! A catalogue is the whole of what a model is *told* about an arm: every module, signature,
//! argument, type and type member the responses-as-code system prompt renders and a documentation
//! view answers with. Every word of it is reflected out of the SDK's own declarations by that
//! language's own documentation tool — `tsc`, griffe, YARD, `purs`, javadoc, the Kotlin front end,
//! rustdoc, `swiftc -emit-symbol-graph`, `clang++ -ast-dump=json`, Roslyn.
//!
//! They were once committed, so that building gg would not require eleven toolchains. That trade is
//! the wrong way round twice over.
//!
//! This repository is developed in a **devcontainer**, and the devcontainer exists precisely so that
//! every developer has one environment rather than eleven personal ones. A toolchain that is
//! required is therefore a toolchain that is *installed* — `scripts/ci/install-gg-toolchains.sh`
//! installs the lot, idempotently, and every surface that builds or lints gg runs it. Committing an
//! artifact so that a developer can skip an install defeats the point of the devcontainer and the
//! point of the artifact at once.
//!
//! And the artifact's point is fidelity. A committed catalogue is a claim about source that is
//! checked at the moment it is generated and never again; between that moment and the next
//! regeneration it can disagree with the SDK it describes, and the disagreement is invisible —
//! nothing about a `.json` file looks stale. What it costs when it happens is not a build error but
//! a model told about a function the guest does not export, or told nothing about one it does.
//! Generated here, the catalogue is reflected out of the SDK sources of *this checkout* on the build
//! that compiles the host embedding it, so a prompt cannot describe a surface the guest does not
//! have. There is no drift left to gate, which is why nothing gates it.
//!
//! Every word of that holds of the artifacts too, which is why they moved the same way, one arm at
//! a time, until none was left. A committed `.jar` looks even less stale than a committed `.json`,
//! and what it costs is the mirror image: not a model told about a function that does not exist, but
//! a model told correctly and then compiled against a library that has not caught up. Both halves of
//! every arm are now cut from the sources of the checkout that builds them, on the same build, so
//! they cannot be two vintages — and `crates/gg/src/sandbox/guests/`, which held the catalogues and
//! then the baked guest components after them, does not exist at all.
//!
//! The four baked interpreters were the last to move and they are the sharpest case, because they
//! are the ones no drift gate could ever have covered: not one of the TypeScript, Python, Ruby or C#
//! components is byte-reproducible, so nothing could re-cut one and diff it. What stood in for that
//! was a manifest each build wrote beside its own output — which could attest what a build had been
//! *told* and never what it produced. Generating them deletes the question rather than answering
//! it.
//!
//! # What it does
//!
//! One line of work: run `scripts/gg-signatures.sh` with `GG_SIGNATURES_OUT_DIR` pointed at
//! `$OUT_DIR/signatures`. That script reads `scripts/gg-arms.sh`, which is the only list of gg's
//! arms in the repository — it is what a person runs by hand to *read* a catalogue, and it is what
//! this runs — so a twelfth arm is one line there and no line here.
//!
//! Before that, [`publish_artifact_roots`], which is mostly bookkeeping: the artifact crates have
//! already run by the time this build script starts, because cargo runs a dependency's build script
//! before its dependent's, and most of what this does is turn what they published into variables the
//! source can name.
//!
//! Mostly, and not entirely — the order of those two calls is load-bearing for exactly one arm. The
//! PureScript catalogue is reflected by compiling that arm's SDK against its **compiled library
//! tree**, which is one of the artifacts `gg-artifact-purescript` builds, so the path it published
//! is handed to the reflector in its environment. See [`reflect`].
//!
//! The rest of this file is the rerun set: the sources whose change must re-reflect a catalogue, and
//! nothing else. Getting that set wrong is worse than it sounds in both directions. Too small, and a
//! developer edits a doc comment, rebuilds, and is silently served the catalogue from before the
//! edit — which is the staleness this whole arrangement exists to abolish. Too large — in
//! particular, naming a directory some step of the reflection *writes into* — and every build runs
//! eleven documentation toolchains again, which is minutes, so the set is written by naming each
//! package's `src`/`Sources` and `tools` subtrees and its pins, never a `.build/`, a `dist/`, a
//! `node_modules/` or a generated-bindings directory.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Command;

fn main() {
    let manifest = PathBuf::from(
        std::env::var("CARGO_MANIFEST_DIR")
            .expect("cargo always sets CARGO_MANIFEST_DIR for a build script"),
    );
    // The repository root, derived from this crate rather than from a working directory: cargo runs
    // a build script with its cwd set to the package root today, but that is a convenience rather
    // than a contract, and every path below is a repository path.
    let root = manifest
        .parent()
        .and_then(Path::parent)
        .expect("crates/gg sits two directories below the repository root")
        .to_path_buf();

    let out_dir = PathBuf::from(
        std::env::var("OUT_DIR").expect("cargo always sets OUT_DIR for a build script"),
    );
    let signatures = out_dir.join("signatures");

    let artifacts = publish_artifact_roots();
    reflect(&root, &signatures, &artifacts);

    for path in rerun_paths(&root) {
        // A path cargo cannot see is a path cargo treats as changed, which would mean re-running
        // eleven toolchains on every build forever. Every entry below exists in a checkout, so an
        // absent one is a rename that has not been followed here — say so rather than quietly
        // rebuilding.
        assert!(
            path.exists(),
            "build.rs names {} in its rerun set and it does not exist; a signature input was \
             renamed or removed without updating this list",
            path.display(),
        );
        println!("cargo:rerun-if-changed={}", path.display());
    }
}

/// Turn every artifact crate's published directory into a `GG_ARTIFACTS_<ARM>` the source can name.
///
/// # The chain, end to end
///
/// ```text
///   crates/gg-sandbox-artifacts/java/Cargo.toml   links = "gg-artifact-java"
///   …/java/build.rs      runs packages/gg-sandbox-java/build.sh into its own OUT_DIR
///        └─ prints  cargo::metadata=root=<that directory>
///   cargo             →  DEP_GG_ARTIFACT_JAVA_ROOT=<that directory>   (here, in this process)
///   this function     →  cargo::rustc-env=GG_ARTIFACTS_JAVA=<that directory>
///   crates/gg/src/sandbox/language/java.compile.rs
///        include_bytes!(concat!(env!("GG_ARTIFACTS_JAVA"), "/java.sdk.jar"))
/// ```
///
/// Which is the same idiom the signature catalogues already use one line further out —
/// `include_str!(concat!(env!("OUT_DIR"), "/signatures/java.signatures.json"))` — so an arm module
/// reads as one habit rather than two. The only difference is whose `OUT_DIR` it is, and that
/// difference is the whole point: an arm's bytes are rebuilt when that arm's sources move, and not
/// when some other arm's do.
///
/// # Why this reads the environment instead of naming the arms
///
/// Because there is already a list of which arm crates exist, and it is `Cargo.toml`'s
/// `[dependencies]` — the place cargo itself reads it from. Cargo sets exactly one
/// `DEP_GG_ARTIFACT_<ARM>_ROOT` per `links` dependency of this package, so scanning for them is not
/// a guess about what is there; it is a reading of the only declaration that could have put
/// anything there. A hand-kept list here would be a second copy of that, free to fall behind it, and
/// the failure would be an arm whose crate is built on every `cargo build` and whose bytes nothing
/// can reach.
///
/// So landing a twelfth arm is one `[dependencies]` line and the `include_bytes!` that uses it, with
/// no line here. There are ten of them today, serving all eleven arms — `gg-artifact-typescript`
/// covers the JavaScript arm as well, because those two arms are one guest — and the loop below
/// publishes whatever cargo put in the environment without caring how many that is.
///
/// Returns the same table it published, keyed by the arm id in upper case, for the one caller that
/// needs a path rather than a variable: [`reflect`], which has to hand the PureScript reflection the
/// library tree that arm's crate just built.
fn publish_artifact_roots() -> BTreeMap<String, PathBuf> {
    // Sorted, because the only reason anybody reads this output is `cargo build -vv` and a build's
    // directives should not reorder themselves between two runs of the same build.
    let mut roots: Vec<(String, String)> = std::env::vars()
        .filter_map(|(key, value)| {
            let arm = key
                .strip_prefix("DEP_GG_ARTIFACT_")?
                .strip_suffix("_ROOT")?;
            Some((arm.to_string(), value))
        })
        .collect();
    roots.sort();

    let mut published = BTreeMap::new();
    for (arm, root) in roots {
        // The artifact crate asserts every file its row promises is present and non-empty before it
        // publishes this, so what is left to check here is only that the directory itself survived —
        // which it would not if somebody cleaned that crate's `OUT_DIR` out from under a cached
        // fingerprint. Caught here it names the arm; missed here it is an `include_bytes!` failing
        // on a path with a hash in it, several files away.
        assert!(
            Path::new(&root).is_dir(),
            "the {arm} arm published {root} as the directory its artifacts were built into and it \
             is not there. Force that arm to rebuild with `cargo clean -p gg-artifact-{}`.",
            arm.to_lowercase(),
        );
        println!("cargo::rustc-env=GG_ARTIFACTS_{arm}={root}");
        published.insert(arm, PathBuf::from(root));
    }
    published
}

/// Run the one script that knows the arms, with its destination pointed into this build's `OUT_DIR`.
///
/// stdout and stderr are both **inherited**. stderr is the important one: when griffe cannot parse a
/// docstring or `swiftc` cannot find its SDK, the sentence that says so is the reflector's own, and
/// a build script that swallowed it in favour of "the signature step failed" would be hiding the
/// only useful thing on the screen. Inheriting stdout costs nothing — cargo captures a build
/// script's stdout looking for `cargo:` directives and ignores every other line, so the orchestrator's
/// per-arm progress is dropped on an ordinary build and shown under `cargo build -vv`, which is
/// exactly where someone wondering what a four-minute build is doing will look.
///
/// # The one arm whose reflection needs another arm's artifact
///
/// Ten of the eleven reflectors read only their own package. The PureScript one cannot: `purs`
/// refuses to type-check a module without the sources *and* the externs of everything it imports
/// (measured: with externs alone, every import is `ModuleNotFound`), and compiling the registry set
/// from scratch is ~16 s. So `packages/gg-sandbox-purescript/signatures.sh` unpacks the arm's
/// **compiled library tree**, stages the working tree's `src/` over the copy inside it, and reflects
/// that — which is also what makes the catalogue a description of the SDK on disk rather than a
/// re-read of whatever was baked.
///
/// That tarball used to be committed, and the requirement was met by naming it in the rerun set
/// below and trusting that a checkout had it. Now it is built by `gg-artifact-purescript`, cargo
/// runs that crate's build script strictly before this one because `crates/gg` depends on it, and
/// the path is handed over in the environment. The ordering stopped being a comment and became an
/// edge in the package graph — which is why this function asserts the variable is there rather than
/// falling back to anything: an absent `DEP_GG_ARTIFACT_PURESCRIPT_ROOT` means the dependency was
/// dropped or moved to `[build-dependencies]`, and either way there is no tree to reflect against.
fn reflect(root: &Path, signatures: &Path, artifacts: &BTreeMap<String, PathBuf>) {
    let script = root.join("scripts/gg-signatures.sh");
    assert!(
        script.is_file(),
        "{} is missing; it is the script that reflects every arm's signature catalogue",
        script.display(),
    );

    let purescript = artifacts.get("PURESCRIPT").unwrap_or_else(|| {
        panic!(
            "the purescript arm published no artifact directory, so there is no compiled library \
             tree to reflect its catalogue against.\n\
             crates/gg/Cargo.toml must depend on gg-artifact-purescript as an ORDINARY dependency \
             — under [build-dependencies] the crate still builds and DEP_GG_ARTIFACT_PURESCRIPT_ROOT \
             is silently absent.",
        )
    });

    let status = Command::new(&script)
        .arg(signatures)
        .env(
            "GG_PURESCRIPT_LIBRARIES",
            purescript.join("purescript.libraries.tar.gz"),
        )
        .current_dir(root)
        .status()
        .unwrap_or_else(|error| {
            panic!(
                "could not run {}: {error}\n\
                 It needs to be executable and it needs a bash on PATH.",
                script.display(),
            )
        });

    assert!(
        status.success(),
        "reflecting gg's signature catalogues failed ({status}).\n\
         \n\
         The message above is from the arm that failed, and it names what it wanted. The two \
         answers that fix almost every one of them:\n\
         \n\
         * a missing toolchain — run scripts/ci/install-gg-toolchains.sh, which installs every \
         arm's documentation tool and is safe to re-run;\n\
         * a checkout whose npm workspaces were never installed (no node_modules, so no `tsc`) — \
         run `npm ci` at the repository root.\n\
         \n\
         The catalogues are what a model is told this sandbox offers, so this build stops here \
         rather than embedding a surface nobody reflected.",
    );
}

/// Every input a reflection reads, and nothing a reflection writes.
///
/// The distinction is the whole of the correctness of this list. A signature step is allowed to
/// write — into a `mktemp -d`, into a package's gitignored `.build/`, into `dist/headers/`, into the
/// generated `packages/gg-sandbox-rust/src/bindings.rs` — and any of those inside the rerun set
/// would make each build invalidate the next one. So directories are named at the granularity of
/// "the SDK a person edits": each package's `src` (or `Sources`) and `tools` subtrees, its
/// `signatures.sh`, its library set and its `<lang>-version.sh` pin.
///
/// The one cross-tree input is deliberate and belongs to specific arms rather than to all of them:
/// `crates/gg/wit` is what the Rust, Swift and C++ arms generate their bindings from before
/// reflecting.
///
/// **The PureScript arm's compiled library tree is a second cross-tree input and it is deliberately
/// NOT in this list**, which is worth saying because it used to be. That tarball was committed under
/// `crates/gg/src/sandbox/checkers/`, so naming it here was the only way to say "re-reflect
/// PureScript when the tree it compiles against moves" — a checkers file in a signature rerun set,
/// which took a paragraph to defend. It is now built by `gg-artifact-purescript` into that crate's
/// `OUT_DIR`, and the way that fact is declared is the `[dependencies]` edge: cargo re-runs a
/// dependent's build script whenever a `links` dependency was rebuilt, so a re-cut tree re-runs this
/// whole reflection with no path naming it. Naming the `OUT_DIR` copy here would be naming a
/// directory of this build's own output — the exact mistake the paragraph above is about.
fn rerun_paths(root: &Path) -> Vec<PathBuf> {
    [
        // This file, the orchestrator it runs, and the one list of the eleven arms that
        // orchestrator sources. `scripts/gg-arms.sh` is named here and not left to the transitive
        // path: it is true that every artifact crate names it too, and that cargo re-runs this
        // build script whenever one of them is rebuilt — but that is a SIDE EFFECT of the `links`
        // edge, and this file's own header calls it out as one. A reflection's rerun set is every
        // input the reflection reads, and `gg-signatures.sh` reads this.
        "crates/gg/build.rs",
        "scripts/gg-signatures.sh",
        "scripts/gg-arms.sh",
        // TypeScript and JavaScript: one guest, one set of declarations, two catalogues. The
        // declaration emit is decided by the repo-root tsconfig the package's own configs extend, so
        // that file is an input here even though nothing in the package names it.
        "packages/gg-sandbox/src",
        "packages/gg-sandbox/tools",
        "packages/gg-sandbox/signatures.sh",
        "packages/gg-sandbox/package.json",
        "packages/gg-sandbox/tsconfig.json",
        "packages/gg-sandbox/tsconfig.headers.json",
        "tsconfig.base.json",
        // Python: griffe parses `src/gg/**` statically, and `src/library.py`'s own imports are the
        // library set. The griffe pin lives in the script.
        "packages/gg-sandbox-python/src",
        "packages/gg-sandbox-python/tools",
        "packages/gg-sandbox-python/signatures.sh",
        // Ruby: YARD parses `src/gg/**` and the reflector additionally requires it, because this
        // arm's operation identity is read off `GG::Surface.registry` rather than a table.
        // `yard-version.sh` is the YARD pin, shared with the installer that puts the gem on the
        // machine — a bump there is a change to what this reflects.
        "packages/gg-sandbox-ruby/src",
        "packages/gg-sandbox-ruby/tools",
        "packages/gg-sandbox-ruby/signatures.sh",
        "packages/gg-sandbox-ruby/yard-version.sh",
        // PureScript: `purs --codegen docs` over the SDK staged into the arm's compiled library
        // tree. That tree is as much an input as the sources are, and it is the one input here that
        // is not a path — see this function's header on why the dependency edge says it instead.
        // `spago.yaml` is the library set.
        "packages/gg-sandbox-purescript/src",
        "packages/gg-sandbox-purescript/tools",
        "packages/gg-sandbox-purescript/signatures.sh",
        "packages/gg-sandbox-purescript/spago.yaml",
        // Java: javadoc with gg's own doclet, compiled fresh from `tools/` on every run.
        "packages/gg-sandbox-java/src",
        "packages/gg-sandbox-java/tools",
        "packages/gg-sandbox-java/signatures.sh",
        "packages/gg-sandbox-java/libraries.txt",
        "packages/gg-sandbox-java/java-version.sh",
        // Kotlin: the compiler front end reading KDoc, driven by gg's own tool. The pin is named
        // even though the script does not source it — the jars it runs are the ones that file picks,
        // so a bump there is a change to what this reflects.
        "packages/gg-sandbox-kotlin/src",
        "packages/gg-sandbox-kotlin/tools",
        "packages/gg-sandbox-kotlin/signatures.sh",
        "packages/gg-sandbox-kotlin/libraries.txt",
        "packages/gg-sandbox-kotlin/kotlin-version.sh",
        // Rust: rustdoc's own JSON. `Cargo.toml` is both the manifest and the library set;
        // `rust-version.sh` reads the channel out of the repo-root `rust-toolchain.toml`, which is
        // the one release this arm's rlibs are compiler-locked to. Its `src` is the one
        // tree named a file at a time rather than as a directory — see [`rust_sdk_sources`].
        "packages/gg-sandbox-rust/tools",
        "packages/gg-sandbox-rust/signatures.sh",
        "packages/gg-sandbox-rust/bindings.sh",
        "packages/gg-sandbox-rust/Cargo.toml",
        "packages/gg-sandbox-rust/Cargo.lock",
        "packages/gg-sandbox-rust/rust-version.sh",
        "rust-toolchain.toml",
        // Swift: a DocC symbol graph out of `swiftc -emit-symbol-graph`, over the SDK compiled
        // against the C bindings `bindings.sh` regenerates into a gitignored `.build/` every run —
        // which is why `.build/` is not here and `crates/gg/wit` is.
        "packages/gg-sandbox-swift/Sources",
        "packages/gg-sandbox-swift/tools",
        "packages/gg-sandbox-swift/signatures.sh",
        "packages/gg-sandbox-swift/bindings.sh",
        "packages/gg-sandbox-swift/libraries.txt",
        "packages/gg-sandbox-swift/swift-version.sh",
        // C++: clang's own comment AST. `Sources/prelude.hpp` carries the library set, so it is
        // inside the subtree already named.
        "packages/gg-sandbox-cpp/Sources",
        "packages/gg-sandbox-cpp/tools",
        "packages/gg-sandbox-cpp/signatures.sh",
        "packages/gg-sandbox-cpp/bindings.sh",
        "packages/gg-sandbox-cpp/cpp-version.sh",
        // C#: Roslyn, compiled against the installed reference assemblies. Only `src/Gg` is the SDK
        // — the package's `Sources/` holds the Mono guest's C, which this arm never compiles.
        "packages/gg-sandbox-csharp/src/Gg",
        "packages/gg-sandbox-csharp/tools",
        "packages/gg-sandbox-csharp/signatures.sh",
        "packages/gg-sandbox-csharp/libraries.txt",
        "packages/gg-sandbox-csharp/csharp-version.sh",
        // The wire the Rust, Swift and C++ arms generate their bindings from. An interface edit
        // changes what those three reflect, and nothing in their own package would say so.
        "crates/gg/wit",
    ]
    .into_iter()
    .map(|path| root.join(path))
    .chain(rust_sdk_sources(root))
    .collect()
}

/// The Rust arm's SDK sources, enumerated, with the one generated file left out.
///
/// This is the single exception to naming a directory, and it exists because
/// `packages/gg-sandbox-rust/bindings.sh` generates `src/bindings.rs` **into the tree rustdoc
/// reads**, on every reflection. That file is gitignored, it is a pure function of `crates/gg/wit`
/// and the pinned `wit-bindgen`, and it is the only file any arm's reflection puts inside a
/// directory this list would otherwise name. Regenerating it every time is deliberate — it is what
/// stops a wire edit from being documented against the bindings of the wire before it, which is the
/// guarantee the Swift and C++ arms get from calling their own `bindings.sh` unconditionally — and
/// it is affordable only because the file is excluded here. Measured, with `src` named as a
/// directory and the bindings written only when absent: a fresh checkout ran the whole reflection
/// twice, because the file the first run created was newer than the fingerprint that run was
/// measured against. It converged on the third build rather than looping, which is the worst kind of
/// bug to leave in — a twenty-second cost that only appears on a machine nobody is watching. With
/// the bindings now rewritten on every run, naming the directory would not converge at all.
///
/// Enumerating loses the one thing a directory buys, which is noticing a file that did not exist
/// before. It is bought back by how Rust works: a new SDK module is unreachable until it is declared
/// in `lib.rs`, and `lib.rs` is enumerated here like every other file. So a module added without a
/// re-reflection is not a state this arm can be in.
fn rust_sdk_sources(root: &Path) -> Vec<PathBuf> {
    let src = root.join("packages/gg-sandbox-rust/src");
    let entries = std::fs::read_dir(&src).unwrap_or_else(|error| {
        panic!(
            "could not read {} to name the Rust arm's SDK sources: {error}",
            src.display(),
        )
    });

    let mut sources: Vec<PathBuf> = entries
        .map(|entry| {
            entry
                .expect("a directory entry cannot vanish mid-read")
                .path()
        })
        .filter(|path| path.file_name().is_some_and(|name| name != "bindings.rs"))
        .collect();
    // Sorted so a build's declared inputs read the same on every machine, which is the only reason a
    // person ever looks at this list under `cargo build -vv`.
    sources.sort();
    sources
}
