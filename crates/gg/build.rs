//! Reflect every program language's signature catalogue out of its own SDK, as a step of building
//! this crate, and hand the eleven JSON files to `OUT_DIR` for the arm modules to `include_str!`.
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
//! # What it does
//!
//! One line of work: run `scripts/gg-signatures.sh` with `GG_SIGNATURES_OUT_DIR` pointed at
//! `$OUT_DIR/signatures`. That script is the only list of gg's arms in the repository — it is what a
//! person runs by hand to *read* a catalogue, and it is what this runs — so a twelfth arm is one
//! line there and no line here.
//!
//! The rest of this file is the rerun set: the sources whose change must re-reflect a catalogue, and
//! nothing else. Getting that set wrong is worse than it sounds in both directions. Too small, and a
//! developer edits a doc comment, rebuilds, and is silently served the catalogue from before the
//! edit — which is the staleness this whole arrangement exists to abolish. Too large — in
//! particular, naming a directory some step of the reflection *writes into* — and every build runs
//! eleven documentation toolchains again, which is minutes, so the set is written by naming each
//! package's `src`/`Sources` and `tools` subtrees and its pins, never a `.build/`, a `dist/`, a
//! `node_modules/` or a generated-bindings directory.

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

    reflect(&root, &signatures);

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

/// Run the one script that knows the arms, with its destination pointed into this build's `OUT_DIR`.
///
/// stdout and stderr are both **inherited**. stderr is the important one: when griffe cannot parse a
/// docstring or `swiftc` cannot find its SDK, the sentence that says so is the reflector's own, and
/// a build script that swallowed it in favour of "the signature step failed" would be hiding the
/// only useful thing on the screen. Inheriting stdout costs nothing — cargo captures a build
/// script's stdout looking for `cargo:` directives and ignores every other line, so the orchestrator's
/// per-arm progress is dropped on an ordinary build and shown under `cargo build -vv`, which is
/// exactly where someone wondering what a four-minute build is doing will look.
fn reflect(root: &Path, signatures: &Path) {
    let script = root.join("scripts/gg-signatures.sh");
    assert!(
        script.is_file(),
        "{} is missing; it is the script that reflects every arm's signature catalogue",
        script.display(),
    );

    let status = Command::new(&script)
        .arg(signatures)
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
/// The two cross-tree inputs are deliberate and belong to specific arms rather than to all of them:
/// `crates/gg/wit` is what the Rust, Swift and C++ arms generate their bindings from before
/// reflecting, and `checkers/purescript.libraries.tar.gz` is the compiled library set the PureScript
/// arm type-checks its staged SDK against.
fn rerun_paths(root: &Path) -> Vec<PathBuf> {
    [
        // This file, and the one script that knows the eleven arms.
        "crates/gg/build.rs",
        "scripts/gg-signatures.sh",
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
        // PureScript: `purs --codegen docs` over the SDK staged into the committed library tree, so
        // the tarball is as much an input as the sources are; `spago.yaml` is the library set.
        "packages/gg-sandbox-purescript/src",
        "packages/gg-sandbox-purescript/tools",
        "packages/gg-sandbox-purescript/signatures.sh",
        "packages/gg-sandbox-purescript/spago.yaml",
        "crates/gg/src/sandbox/checkers/purescript.libraries.tar.gz",
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
        // the one release this arm's committed rlibs are compiler-locked to. Its `src` is the one
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
