//! The shared build-script body behind every `crates/gg-sandbox-artifacts/<arm>` crate.
//!
//! # What an artifact crate is, and why there are ten of them
//!
//! gg drives a model in one of eleven program languages. Each arm needs files on disk that a turn
//! cannot fetch — a guest component with a whole language runtime baked into it, a compiled library
//! set a program is linked or type-checked against, a compiler small enough to travel inside gg's
//! own binary — and `crates/gg` embeds every one of them with `include_bytes!`/`include_str!`,
//! because gg is copied as a SINGLE FILE into an ephemeral run container.
//!
//! Those files used to be committed: ~117 MB across ~33 blobs under `crates/gg/src/sandbox/`. They
//! are generated now, for the reason the eleven signature catalogues stopped being committed one
//! change earlier — a committed artifact is a claim about source that is checked when it is
//! generated and never again, and nothing about a `.wasm` file looks stale. What it costs when it
//! goes wrong is not a build error but a model compiled against an SDK its prompt does not describe.
//! `crates/gg/build.rs`'s header is the long form of that argument; this is the same argument one
//! level up, for the bytes rather than for the description of them.
//!
//! # Why ten crates rather than ten steps of `crates/gg/build.rs`
//!
//! Because a build script has ONE rerun set, and a flat one would make every declared input cost the
//! whole set. Measured on an 18-core aarch64 machine, warm: the nine non-C# arms' builds are ~69 s
//! sequential and C# adds 26 s, the signature reflection is 11.2 s, and `crates/gg` itself is about
//! 12 s to compile — so a flat set would make EVERY declared input cost about two minutes. Under one
//! build script, editing a Python docstring would re-run `swiftc`; and because five of the arms are
//! not byte-reproducible, that is not a no-op — tens of megabytes of `include_bytes!` genuinely
//! change and `crates/gg` recompiles for nothing. gg SDK work is the bulk of gg development, so a
//! two-minute inner loop on every edit is not a cost anybody would pay twice.
//!
//! That five arms are non-reproducible is measured rather than assumed, and the C# one is the
//! sharpest: `componentize-js` and `componentize-py` snapshot a pre-initialised heap, `swiftc` stamps
//! a random module hash, and the C# link bakes its own toolchain's ABSOLUTE PATHS into the component
//! — two builds of one checkout differing only in where the SDK was unpacked came out 48 bytes
//! apart. It is the reason "commit it and diff a rebuild in CI" was never available for these arms,
//! and therefore the reason generating them is the only way their currency was ever going to be
//! knowable.
//!
//! Ten crates buy three things a flat set cannot:
//!
//! * **per-arm staleness** — editing the Java SDK re-cuts the Java jar and no other arm's anything;
//! * **parallelism** — cargo runs independent build scripts concurrently, so a cold artifact build
//!   costs about what the SLOWEST arm costs (C#, ~26 s) rather than the sum;
//! * **ordering as a type** — `test-cabinet-gg` depends on `gg-artifact-purescript`, so cargo runs
//!   that arm's build script strictly before `crates/gg`'s. The PureScript signature reflection
//!   reads the compiled library tarball, and that used to be a hand-kept comment about which
//!   committed file had to exist first. `crates/gg/build.rs` hands the path over in
//!   `GG_PURESCRIPT_LIBRARIES`; see that file's `reflect`.
//!
//! ONE THING PER-ARM STALENESS DOES **NOT** BUY, measured rather than assumed: when any arm crate's
//! build script re-runs, cargo re-runs `crates/gg`'s build script too — a dependent's build script
//! is dirty when a `links` dependency was rebuilt, whether or not the metadata it published changed
//! value. So re-cutting one jar also re-reflects all eleven signature catalogues (~12 s here). For
//! the ordinary case that costs nothing at all, because an SDK edit was already in the signature
//! rerun set and was always going to re-reflect; it shows up only for inputs that belong to an
//! artifact build and to nothing else, such as a `build.sh` or the Rust arm's `Cargo.lock`.
//! Measured on this machine: touching `packages/gg-sandbox-java/build.sh` costs 30 s, of which 4 s
//! is the jar, ~12 s is the reflection and ~11 s is recompiling `crates/gg` around the changed
//! embed. Not free, and an order of magnitude better than the ~92 s a flat rerun set would make
//! *every* input cost.
//!
//! What it costs, stated plainly, is ten crate directories and the manifest lines that name them.
//! Cargo cannot be talked out of those.
//!
//! # How an arm's bytes reach `crates/gg`
//!
//! Cargo's `links` channel, which is the one mechanism that lets a build script hand a value to a
//! DEPENDENT's build script:
//!
//! ```text
//!   crates/gg-sandbox-artifacts/swift/Cargo.toml   links = "gg-artifact-swift"
//!   …/swift/build.rs                               gg_artifact_build::arm("swift")
//!        └─ prints  cargo::metadata=root=<OUT_DIR>/artifacts
//!   crates/gg/build.rs      reads  DEP_GG_ARTIFACT_SWIFT_ROOT
//!        └─ prints  cargo::rustc-env=GG_ARTIFACTS_SWIFT=<that path>
//!   crates/gg/src/…/swift.compile.rs
//!        include_bytes!(concat!(env!("GG_ARTIFACTS_SWIFT"), "/swift.guest.tar.gz"))
//! ```
//!
//! ONE TRAP, MEASURED AND WORTH THE LINE: the dependency edge must be an ordinary `[dependencies]`
//! entry. Declared under `[build-dependencies]` instead, cargo builds the artifact crate perfectly
//! well and the `DEP_*` variable is simply **not present** in the dependent's build script — no
//! warning, no error, just `NotPresent`. That is the same shape as `env!` on a variable nobody set,
//! and it is discovered as an unhelpful compile error several files away.
//!
//! # Adding a twelfth arm
//!
//! One row in `scripts/gg-arms.sh`, one entry in this crate's `rerun_paths` table, and three
//! files:
//!
//! ```text
//!   crates/gg-sandbox-artifacts/<arm>/Cargo.toml    name, links = "gg-artifact-<arm>", this crate
//!   crates/gg-sandbox-artifacts/<arm>/build.rs      fn main() { gg_artifact_build::arm("<arm>") }
//!   crates/gg-sandbox-artifacts/<arm>/src/lib.rs    empty; a `links` package needs a lib target
//! ```
//!
//! plus one `members` line in the root `Cargo.toml` and one `[dependencies]` line in
//! `crates/gg/Cargo.toml`. Everything with any substance in it is here, once, rather than ten times.
//!
//! # Where this stands
//!
//! **THE SET IS COMPLETE.** Ten crates serve eleven arms: `typescript` (which serves the JavaScript
//! arm too, exactly as `packages/gg-sandbox` and `scripts/gg-arms.sh` do — those two arms are one
//! guest differing only in whether gg type-checks the program on the way in), `python`, `ruby`,
//! `java`, `kotlin`, `rust`, `purescript`, `cpp`, `swift` and `csharp`. Nothing `crates/gg` embeds
//! is committed: `crates/gg/src/sandbox/guests/` does not exist any more, and `checkers/` beside it
//! holds five files that are gg's own hand-written Java and its two JVM pin declarations.
//!
//! They landed one at a time, and the order was the invariant: an arm got its crate on the change
//! that deleted that arm's artifacts from git, never before, because a crate here is a crate whose
//! build script runs on every `cargo build --workspace`, and running an arm's toolchain to produce
//! bytes nothing embeds is pure cost. It is worth recording that this was staged rather than done in
//! one step, because the staging was not caution for its own sake: the C# arm's build is the only
//! one needing toolchains no gg run installs (see `scripts/ci/install-gg-build-toolchains.sh`), so
//! making `crates/gg` depend on it before that infrastructure existed would have broken `cargo
//! build` on every checkout at once.
//!
//! Two consequences of "the whole arm, or none of it" are worth knowing, because both look odd:
//!
//! * An arm has ONE `build.sh` and it writes everything that arm's row promises, so the four arms
//!   whose row lists a guest component AND something else — TypeScript's checker, Ruby's Opal
//!   compiler — cut both on every rerun. There is no way to ask an arm for part of its row, and
//!   there deliberately is not: it would be a second list of what-produces-what beside
//!   `scripts/gg-arms.sh`, and it buys nothing now that every arm's whole row is wanted. (There was
//!   a window in which the TypeScript and Ruby crates produced components nothing embedded, because
//!   their arms had crates before the committed components were deleted. That is over; no arm has
//!   dead output.)
//! * The pairing that buys is the Ruby arm's, and it is the best single argument for this shape:
//!   that SDK is lowered to JavaScript **twice** from one `src/`, once into the baked component and
//!   once into the host-side compiler that lowers the model's program. One `build.sh` and one rerun
//!   set means they cannot be cut at different vintages, which nothing checked before and nothing
//!   needs to check now.

use std::path::{Path, PathBuf};
use std::process::Command;

/// Build one arm's artifacts and publish the directory they landed in.
///
/// Called from an artifact crate's `build.rs` with that crate's arm id, which is the id
/// `scripts/gg-arms.sh` declares, the stem the artifacts are named for, and the suffix of the
/// `links` key the crate's manifest sets.
pub fn arm(id: &str) {
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
        .and_then(Path::parent)
        .expect("an artifact crate sits three directories below the repository root")
        .to_path_buf();

    let out_dir = PathBuf::from(
        std::env::var("OUT_DIR").expect("cargo always sets OUT_DIR for a build script"),
    );
    // A subdirectory of `OUT_DIR` rather than `OUT_DIR` itself, so that what is published to the
    // dependent is a directory holding EXACTLY this arm's artifacts. `OUT_DIR` is also where cargo
    // and any other build step put their own scratch, and a published root that contained anything
    // else would make `include_bytes!(concat!(env!(…), "/x"))` a guess rather than a contract.
    let artifacts = out_dir.join("artifacts");

    let row = Row::read(&root, id);
    row.empty(&artifacts);
    build(&root, &row, &artifacts);
    row.check(&artifacts);

    // The one line that makes any of this reachable. Cargo turns `cargo::metadata=root=…` on a
    // package declaring `links = "gg-artifact-<arm>"` into `DEP_GG_ARTIFACT_<ARM>_ROOT` in the
    // environment of every build script that depends on it — see this module's header for the
    // `[build-dependencies]` trap.
    println!("cargo::metadata=root={}", artifacts.display());

    declare_rerun_set(&root, id);
}

/// One arm's row in `scripts/gg-arms.sh`: the package that builds it, and what it promises to write.
///
/// Read out of the table by sourcing it, rather than restated here, because `gg-arms.sh` is the one
/// list of gg's arms and a second copy in Rust would be free to fall a rename behind it. Sourcing a
/// shell file from a build script is unusual enough to be worth defending: the alternative is a
/// parser for a format whose only definition is the shell that reads it, which is a worse way to be
/// wrong. `bash` is already an unconditional prerequisite of this build — everything below runs
/// `build.sh` — so this costs no new dependency.
struct Row {
    id: String,
    package: String,
    artifacts: Vec<String>,
}

impl Row {
    fn read(root: &Path, id: &str) -> Self {
        let script = format!(
            "source '{}/scripts/gg-arms.sh'; \
             printf '%s\\n' \"${{GG_ARM_PACKAGE[{id}]:?no such arm in gg-arms.sh}}\"; \
             printf '%s\\n' \"${{GG_ARM_ARTIFACTS[{id}]:?no such arm in gg-arms.sh}}\"",
            root.display(),
        );
        let output = Command::new("bash")
            .arg("-euo")
            .arg("pipefail")
            .arg("-c")
            .arg(&script)
            .current_dir(root)
            .output()
            .unwrap_or_else(|error| {
                panic!("could not run bash to read scripts/gg-arms.sh: {error}")
            });
        assert!(
            output.status.success(),
            "reading the '{id}' arm's row out of scripts/gg-arms.sh failed ({}).\n{}",
            output.status,
            String::from_utf8_lossy(&output.stderr),
        );

        let text = String::from_utf8(output.stdout)
            .expect("scripts/gg-arms.sh holds nothing that is not UTF-8");
        let mut lines = text.lines();
        let package = lines
            .next()
            .expect("the row reader prints two lines")
            .to_string();
        let artifacts = lines
            .next()
            .expect("the row reader prints two lines")
            .split_whitespace()
            .map(str::to_string)
            .collect();

        Self {
            id: id.to_string(),
            package,
            artifacts,
        }
    }

    /// Remove every file this arm's row promises, before the arm is asked to write them.
    ///
    /// WITHOUT THIS, [`Row::check`] IS NOT A CHECK. Cargo never clears `OUT_DIR` between re-runs of
    /// a build script — that is the whole reason `OUT_DIR` is a useful place to cache anything — so
    /// on the second and every later run of an arm, last run's artifacts are already sitting in the
    /// destination, present and non-empty. An arm whose `build.sh` exited 0 having written nothing,
    /// or having written under a name the host does not embed, would leave them there and pass, and
    /// `crates/gg` would embed a vintage from before the edit that triggered the rebuild. That is
    /// the silent staleness generating these artifacts exists to abolish, reintroduced by the one
    /// difference between this entry point and the by-hand one: `scripts/gg-artifacts.sh` empties
    /// its destination for exactly this reason and says so under the heading "EMPTY THE DESTINATION
    /// FIRST".
    ///
    /// Only the files the row promises, never the directory: `OUT_DIR` is cargo's and a build
    /// script that `rm -rf`s a directory cargo handed it is a build script with a very long-barrelled
    /// footgun. Absence is not an error — the first run of an arm has nothing to remove.
    fn empty(&self, artifacts: &Path) {
        for artifact in &self.artifacts {
            let path = artifacts.join(artifact);
            match std::fs::remove_file(&path) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => panic!(
                    "could not remove the previous {} from {}: {error}",
                    artifact,
                    artifacts.display(),
                ),
            }
        }
    }

    /// Every file this arm's row promises, present and non-empty.
    ///
    /// Not a drift check — there is nothing to drift from — but a check that the arm did what its
    /// row says it does. A build script that exited 0 having written nothing, or having written
    /// under a name the host does not embed, would otherwise be discovered as an `include_bytes!` of
    /// a file that is not there, in a crate several layers away from the thing that went wrong.
    /// Deliberately paranoid about emptiness as well as absence: a zero-byte guest component fails
    /// at instantiation inside somebody's run rather than here.
    ///
    /// It only means anything because [`Row::empty`] ran first; see that function.
    fn check(&self, artifacts: &Path) {
        for artifact in &self.artifacts {
            let path = artifacts.join(artifact);
            let bytes = std::fs::metadata(&path).map(|metadata| metadata.len());
            assert!(
                matches!(bytes, Ok(size) if size > 0),
                "{}/build.sh reported success and did not write a non-empty {artifact}.\n\
                 Its row in scripts/gg-arms.sh is what says it should have, and {} is where it was \
                 told to write.",
                self.package,
                artifacts.display(),
            );
        }
    }
}

/// Run the arm's one build script, with its destination pointed into this build's `OUT_DIR`.
///
/// stdout and stderr are both **inherited**. stderr is the important one: when `swiftc` cannot find
/// its SDK or `componentize-js` refuses a WIT world, the sentence that says so is the toolchain's
/// own, and a build script that swallowed it in favour of "the artifact step failed" would be hiding
/// the only useful thing on the screen. Inheriting stdout costs nothing — cargo captures a build
/// script's stdout looking for `cargo::` directives and ignores every other line, so the arm's
/// progress is dropped on an ordinary build and shown under `cargo build -vv`, which is exactly
/// where somebody wondering what a twenty-second build is doing will look.
fn build(root: &Path, row: &Row, artifacts: &Path) {
    let script = root.join(&row.package).join("build.sh");
    assert!(
        script.is_file(),
        "{} is missing; it is the one script that builds the {} arm's artifacts",
        script.display(),
        row.id,
    );

    std::fs::create_dir_all(artifacts)
        .unwrap_or_else(|error| panic!("could not create {}: {error}", artifacts.display()));

    let status = Command::new(&script)
        .env("GG_ARTIFACTS_OUT_DIR", artifacts)
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
        "building the {} arm's artifacts failed ({status}).\n\
         \n\
         The message above is from the toolchain that failed, and it names what it wanted. The \
         three answers that fix almost every one of them:\n\
         \n\
         * a missing toolchain — run scripts/ci/install-gg-toolchains.sh, which installs every \
         arm's compiler and every pinned tool its build reaches for, and is safe to re-run;\n\
         * the csharp arm specifically — run scripts/ci/install-gg-build-toolchains.sh, which is \
         separate because it is ~1.4 GB no gg RUN needs;\n\
         * a checkout whose npm workspaces were never installed (no node_modules, so no `tsc`) — \
         run `npm ci` at the repository root.\n\
         \n\
         These bytes are what a model's program is compiled and evaluated against, so this build \
         stops here rather than embedding an artifact nobody produced.",
        row.id,
    );
}

/// Every input an arm's build READS, and nothing it writes.
///
/// The distinction is the whole of the correctness of this table, and it is the same one
/// `crates/gg/build.rs` spends a paragraph on for the signature reflections. A build step is allowed
/// to write — into its package's gitignored `.build/`, into a `mktemp -d`, into a staging tree — and
/// any of those inside a rerun set would make each build invalidate the next one. So directories are
/// named at the granularity of "the SDK a person edits": each package's `src` (or `Sources`) subtree,
/// its `build.sh`, its `bindings.sh`, its library set and its `<lang>-version.sh` pin.
///
/// Two arms cannot be named as directories at all, because their builds write inside their own
/// source trees: see [`rust_sdk_sources`] and [`python_sdk_sources`], which enumerate instead.
///
/// Too small a set is the other failure and it is worse, because it is silent: a developer edits an
/// SDK, rebuilds, and is served the artifact from before the edit — which is exactly the staleness
/// this whole arrangement exists to abolish.
///
/// `crates/gg/wit` appears for the six arms that generate bindings from it. It is deliberately not a
/// blanket entry: an interface edit changes what those six compile against and nothing in their own
/// packages would say so, while the JVM, PureScript and TypeScript-checker halves never read it.
fn rerun_paths(root: &Path, id: &str) -> Vec<PathBuf> {
    let paths: Vec<&str> = match id {
        // TypeScript and JavaScript: one guest, one component, four checker files. The declaration
        // emit is decided by the repo-root tsconfig the package's own configs extend, so that file
        // is an input here even though nothing in the package names it — measured, when changing
        // `target` alone changed the JavaScript in eight emitted files, `shim.js` among them.
        // `package.json` pins the `typescript` the checker is cut from.
        "typescript" => vec![
            "packages/gg-sandbox/src",
            "packages/gg-sandbox/tools",
            "packages/gg-sandbox/build.sh",
            "packages/gg-sandbox/package.json",
            "packages/gg-sandbox/tsconfig.json",
            "packages/gg-sandbox/tsconfig.headers.json",
            "tsconfig.base.json",
            "crates/gg/wit",
        ],
        // Python: the shim, the SDK and the curated library set are baked; `requirements.txt` is
        // exactly what step 1 vendors and step 3 takes the import closure of. `tools/` is the
        // reflector's and is not read here. Its `src` is the second of the two trees named a file at
        // a time rather than as a directory — see [`python_sdk_sources`].
        "python" => vec![
            "packages/gg-sandbox-python/build.sh",
            "packages/gg-sandbox-python/requirements.txt",
            "crates/gg/wit",
        ],
        // Ruby: `tools/guest.mjs` lowers the SDK and the library set and `tools/compiler.mjs` cuts
        // the host-side compiler, so a change to either changes the artifacts with no Ruby moving.
        "ruby" => vec![
            "packages/gg-sandbox-ruby/src",
            "packages/gg-sandbox-ruby/tools",
            "packages/gg-sandbox-ruby/build.sh",
            "packages/gg-sandbox-ruby/opal-version.sh",
            "crates/gg/wit",
        ],
        // PureScript: `spago.yaml` is the library set and `spago.lock` is what it resolved to, and
        // both are compiled into the tree beside this package's own SDK.
        "purescript" => vec![
            "packages/gg-sandbox-purescript/src",
            "packages/gg-sandbox-purescript/build.sh",
            "packages/gg-sandbox-purescript/spago.yaml",
            "packages/gg-sandbox-purescript/spago.lock",
            "packages/gg-sandbox-purescript/purescript-version.sh",
        ],
        // Java and Kotlin: an SDK, compiled to a jar, against a pinned JDK and TeaVM. Neither reads
        // the WIT — these two arms cross the membrane through the JVM arms' shared backend, which is
        // gg's own hand-written source under `crates/gg/src/sandbox/checkers/`.
        "java" => vec![
            "packages/gg-sandbox-java/src",
            // The one vendored TeaVM runtime class, which is compiled into the same jar. It is not
            // gg's text but it is gg's artifact: a change to it changes what an uncaught exception
            // says, and that must re-cut the jar like any other source.
            "packages/gg-sandbox-java/vendor",
            "packages/gg-sandbox-java/build.sh",
            "packages/gg-sandbox-java/java-version.sh",
        ],
        // Kotlin names the JAVA arm's pin too, and it is not a copy-paste slip: this arm's
        // `build.sh` puts the TeaVM jars on the classpath its SDK is compiled against, and which
        // TeaVM those are is decided in `java-version.sh` rather than here. Without this line a
        // TeaVM bump re-cut the Java jar and left the Kotlin one at the previous vintage.
        "kotlin" => vec![
            "packages/gg-sandbox-kotlin/src",
            "packages/gg-sandbox-kotlin/build.sh",
            "packages/gg-sandbox-kotlin/kotlin-version.sh",
            "packages/gg-sandbox-java/java-version.sh",
        ],
        // Rust: `Cargo.toml` is both the manifest and the curated set a model may name, `Cargo.lock`
        // is the exact versions compiled in, and `rust-toolchain.toml` is the compiler the rlibs are
        // version-locked to. Its `src` is the one tree named a file at a time — see
        // [`rust_sdk_sources`].
        "rust" => vec![
            "packages/gg-sandbox-rust/build.sh",
            "packages/gg-sandbox-rust/bindings.sh",
            "packages/gg-sandbox-rust/Cargo.toml",
            "packages/gg-sandbox-rust/Cargo.lock",
            "packages/gg-sandbox-rust/rust-version.sh",
            "rust-toolchain.toml",
            "crates/gg/wit",
        ],
        // Swift: `libraries.txt` declares the curated set, and the three vendored package versions
        // that decide what is in the archive live in `swift-version.sh`.
        "swift" => vec![
            "packages/gg-sandbox-swift/Sources",
            "packages/gg-sandbox-swift/build.sh",
            "packages/gg-sandbox-swift/bindings.sh",
            "packages/gg-sandbox-swift/libraries.txt",
            "packages/gg-sandbox-swift/swift-version.sh",
            "crates/gg/wit",
        ],
        // C++: `Sources/prelude.hpp` carries the library set, so it is inside the subtree already
        // named.
        "cpp" => vec![
            "packages/gg-sandbox-cpp/Sources",
            "packages/gg-sandbox-cpp/build.sh",
            "packages/gg-sandbox-cpp/bindings.sh",
            "packages/gg-sandbox-cpp/cpp-version.sh",
            "crates/gg/wit",
        ],
        // C#: only `Sources/` — the C this build compiles into the guest. `src/Gg` is the SDK Roslyn
        // compiles on the HOST at run time, so it is an input to the reflection and not to this.
        // `cpp-version.sh` is named because `csharp-version.sh` sources it for the wasi-sdk release.
        "csharp" => vec![
            "packages/gg-sandbox-csharp/Sources",
            "packages/gg-sandbox-csharp/build.sh",
            "packages/gg-sandbox-csharp/bindings.sh",
            "packages/gg-sandbox-csharp/csharp-version.sh",
            "packages/gg-sandbox-cpp/cpp-version.sh",
            "crates/gg/wit",
        ],
        other => panic!(
            "no rerun set is declared for the '{other}' arm.\n\
             Adding an arm is a row in scripts/gg-arms.sh AND an entry in this table: the row says \
             what the arm produces, and only this can say what it reads.",
        ),
    };

    paths
        .into_iter()
        .map(|path| root.join(path))
        .chain(match id {
            "rust" => rust_sdk_sources(root),
            "python" => python_sdk_sources(root),
            _ => Vec::new(),
        })
        .collect()
}

/// Print the arm's rerun set, and the environment that can redirect its toolchains.
///
/// A path cargo cannot see is a path cargo treats as changed, which would mean re-running an arm's
/// whole toolchain on every build for ever. Every entry exists in a checkout, so an absent one is a
/// rename that has not been followed here — say so rather than quietly rebuilding.
fn declare_rerun_set(root: &Path, id: &str) {
    // `build.sh` runs `scripts/gg-artifacts-out-dir.sh` and the scratch lock, and for several arms
    // the shared download and npm-tool resolvers, so those are inputs to every arm as much as its
    // own script is. So is the table this crate reads its row out of.
    let shared = [
        "scripts/gg-arms.sh",
        "scripts/gg-artifacts-out-dir.sh",
        "scripts/gg-downloads.sh",
        "scripts/gg-npm-tools.sh",
        "scripts/gg-scratch-lock.sh",
    ];

    for path in shared
        .into_iter()
        .map(|path| root.join(path))
        .chain(rerun_paths(root, id))
    {
        assert!(
            path.exists(),
            "the {id} arm names {} in its rerun set and it does not exist; an artifact input was \
             renamed or removed without updating gg-artifact-build's table",
            path.display(),
        );
        println!("cargo::rerun-if-changed={}", path.display());
    }

    // The overrides that change WHICH toolchain builds the artifact. They are not files, so cargo
    // cannot watch them as paths — but a developer who points `TCAB_GG_SWIFT_HOME` at a second
    // toolchain and rebuilds must get an artifact built by it, not the one already in `OUT_DIR`.
    for variable in [
        "TCAB_GG_SWIFT_HOME",
        "TCAB_GG_WASI_SDK_HOME",
        "TCAB_GG_DOTNET_HOME",
        "TCAB_GG_BUILD_PREFIX",
        "TCAB_GG_WIT_BINDGEN",
        "TCAB_GG_WASMTIME_ADAPTER",
        "TCAB_GG_SWIFT_LIBRARIES",
        "TCAB_GG_SPAGO_CACHE",
        "TCAB_GG_NPM_PREFIX",
        "JAVA_INSTALL_DIR",
        "KOTLIN_INSTALL_DIR",
    ] {
        println!("cargo::rerun-if-env-changed={variable}");
    }
}

/// The Rust arm's SDK sources, enumerated, with the one generated file left out.
///
/// One of TWO exceptions to naming a directory — [`python_sdk_sources`] is the other, and the two
/// exist for one reason wearing two faces: a build step that WRITES inside a directory its own rerun
/// set names invalidates the next build with its own output.
///
/// Here the writer is `packages/gg-sandbox-rust/bindings.sh`, which generates `src/bindings.rs`
/// **into the tree the compile reads**, on every build. That file is gitignored and is a pure
/// function of `crates/gg/wit` and the pinned `wit-bindgen`. Regenerating it every time is
/// deliberate — it is what stops a wire edit from being compiled against the bindings of the wire
/// before it — and it is affordable only because the file is excluded here. `crates/gg/build.rs`
/// carries the same exception, for the same arm, for the same reason, and records what happened
/// without it: a fresh checkout ran the whole reflection twice, then converged, which is the worst
/// kind of bug to leave in.
///
/// Enumerating loses the one thing a directory buys, which is noticing a file that did not exist
/// before. It is bought back by how Rust works: a new SDK module is unreachable until it is declared
/// in `lib.rs`, and `lib.rs` is enumerated here like every other file.
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

/// The Python arm's SDK sources, enumerated recursively, with the bytecode caches left out.
///
/// The second exception to naming a directory, and the more expensive of the two to have missed.
/// `componentize-py` imports the shim to take its import closure, and the CPython it does that with
/// drops a `__pycache__/` beside every module it touches — inside `packages/gg-sandbox-python/src`,
/// which is this arm's own rerun set. MEASURED, with that directory named: touching one SDK file cost
/// **two** full 27-second rebuilds of this arm before converging, the second one being cargo
/// noticing the `.pyc` the first one wrote. Every other arm converges in one; this was the only one
/// that did not, which is how it was found.
///
/// **`PYTHONDONTWRITEBYTECODE` does not fix it, and that is worth writing down because it is the
/// obvious first answer and it is wrong.** `packages/gg-sandbox-python/signatures.sh` uses exactly
/// that, successfully, and carries its own paragraph on why — but `componentize-py` is a Rust binary
/// with an embedded interpreter it configures itself, and with the variable exported from
/// `build.sh` a build still left 19 `.pyc` files under `src/`. So the write cannot be prevented and
/// the watch has to be narrowed instead, which is the Rust arm's answer to the same shape.
///
/// Recursive, where [`rust_sdk_sources`] is one level, because this SDK is a package: `src/shim.py`
/// and `src/library.py` at the top, `src/gg/**` under it. Only FILES are returned, never the
/// directories holding them — a directory in a rerun set is walked by cargo, which would pull the
/// caches straight back in.
///
/// Enumerating loses noticing a file that did not exist before, and Python buys it back the way Rust
/// does even though it has no `mod` declaration: `componentize-py` bakes the IMPORT CLOSURE of the
/// shim, so a module nothing imports is not in the artifact at all, and whatever does import it is
/// enumerated here.
fn python_sdk_sources(root: &Path) -> Vec<PathBuf> {
    let src = root.join("packages/gg-sandbox-python/src");
    let mut sources = Vec::new();
    let mut stack = vec![src];
    while let Some(dir) = stack.pop() {
        let entries = std::fs::read_dir(&dir).unwrap_or_else(|error| {
            panic!(
                "could not read {} to name the Python arm's SDK sources: {error}",
                dir.display(),
            )
        });
        for entry in entries {
            let path = entry
                .expect("a directory entry cannot vanish mid-read")
                .path();
            if path.is_dir() {
                if path.file_name().is_some_and(|name| name == "__pycache__") {
                    continue;
                }
                stack.push(path);
            } else {
                sources.push(path);
            }
        }
    }
    // Sorted for the same reason the Rust arm's list is: a build's declared inputs should read the
    // same on every machine, and `read_dir` order is the filesystem's.
    sources.sort();
    sources
}
