//! **Every hand-built committed artifact against the sources in this checkout** — the gate that
//! catches one nobody rebuilt.
//!
//! Six of the eleven arms commit a binary that a person rebuilds by hand. Three are guest
//! components — TypeScript (whose component the JavaScript arm shares), Python and Ruby, 14 to 25 MB
//! of baked interpreter each — and three are compile inputs: the Rust library set, the Swift guest
//! and library archives, and the C++ guest archive. `scripts/ci/contract-drift.sh` re-cuts none of
//! them, and says at length why: the builds want `componentize-js`, `componentize-py`, a ~200 MB
//! wasi-sdk or an ~835 MB Swift toolchain, and two of the six are not byte-reproducible, so a drift
//! check that rebuilt them would fail on every run over bytes nobody edited.
//!
//! What that leaves is one silent, expensive way for the checkout and an artifact to disagree: a
//! source edited without a rebuild, which leaves every program of that arm evaluated by — or
//! compiled against — what was committed, while the source in front of a reader, and the catalogue
//! the model is shown, describe something else. The checks that do inspect these artifacts today
//! cover part of that at most:
//!
//! * `bound-tools` against [`ALL_TOOL_NAMES`](crate::tools::ALL_TOOL_NAMES) compares **tool names**,
//!   and stays green against a guest whose scope construction, refusals or argument handling changed
//!   without any tool doing so — precisely the shape of the change that made every SDK static, which
//!   touched three guests' scope builders and not one tool name;
//! * the C++ archive carries the prelude, the shell and every SDK **header** as source and
//!   `cpp.compile.test.rs` compares them file for file — but not `Sources/sdk/*.cpp`, so a change to
//!   what a function *does* was invisible;
//! * the Swift archive carries `shell.swift` and the bridging header, compared the same way — but
//!   the SDK is `gg.o` and `gg.swiftmodule`, which is the whole model-facing surface and none of it
//!   comparable;
//! * the Rust set carries nothing as source at all, and its one gate asks which `rustc` built it.
//!
//! So each build writes a manifest beside its artifacts — every source's SHA-256, each artifact's
//! size and digest, the toolchain pins, and a digest of the wire — and this recomputes all of it
//! from the checkout and fails **by arm name**, quoting the command that fixes it.
//!
//! **WHAT THIS PROVES, AND WHAT IT DOES NOT.** It proves an artifact matches the sources recorded
//! beside it. It does **not** prove the artifact was built correctly from them — that the build
//! script compiled what it meant to, that the guest behaves as the SDK reads, that the surface the
//! catalogue describes is the surface a program reaches. Those are what the per-arm substrate,
//! compile and surface tests are for; this gate neither replaces nor weakens one of them, and a
//! green result here says only that nobody forgot to run `build.sh`.
//!
//! Five comparisons, each closing a different way the two can part: the manifest against its
//! artifacts; the manifest against every source in this checkout, in both directions, so an added
//! or deleted source is as much a failure as an edited one; the manifest against
//! [`crates/gg/wit`](super) — the one input none of these packages holds a copy of; the manifest
//! against the pins; and every committed FILE in the two directories gg embeds from against the set
//! of gates, so a **seventh** artifact arriving with no gate at all fails here rather than being
//! the hole one directory up.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;
use sha2::{Digest, Sha256};

/// One arm's hand-built artifacts: where its manifest is, what it produces, which sources go into
/// it, which pins it records, and what rebuilds the lot.
struct Arm {
    /// The arm's display name, for a failure that has to say *which* of eleven is stale.
    name: &'static str,
    /// The manifest, relative to the repository root.
    manifest: &'static str,
    /// Everything the build commits, relative to the repository root. Written out here as well as
    /// in the manifest so that an artifact dropped from the manifest — the one edit that would
    /// quietly narrow this gate — fails instead of shrinking it.
    artifacts: &'static [&'static str],
    /// The source trees the manifest digests, relative to the repository root.
    roots: &'static [&'static str],
    /// Individual files outside those trees that the build consumes all the same, taken from each
    /// `build.sh` rather than guessed: a lockfile, a pinned requirements list, a compiler
    /// configuration, the tool that lowers one arm's SDK — and every arm's own `build.sh`, because
    /// the recipe is an input. An edit to a compile flag or a `--disable` changes what the artifact
    /// is with no source under `roots` moving, and this is what makes that an ordinary failure.
    files: &'static [&'static str],
    /// Paths under `roots` that a tool writes and nobody edits — CPython's bytecode cache, the Rust
    /// arm's generated WIT bindings — which the manifest writer skips and this must skip
    /// identically. Both are `.gitignore`d, so digesting one would fail this test for a file a
    /// fresh checkout does not have.
    ignore: &'static [&'static str],
    /// The pins the manifest records, each paired with the shell variable that sets it and the file
    /// that variable lives in, so a bump fails here and says where it was made.
    pins: &'static [(&'static str, &'static str, &'static str)],
    /// What a stale artifact costs *this* arm, in one sentence, printed in the failure.
    ///
    /// Written per arm rather than once, because the sentence is not the same on all six and the
    /// difference is what tells whoever hit it how urgent this is: on a dynamic arm the guest *is*
    /// the surface, and on a compiled arm it is what a program links against.
    consequence: &'static str,
    /// The command that rebuilds the artifacts and rewrites the manifest.
    rebuild: &'static str,
}

/// **Every arm with a hand-built committed artifact**, in the order the arms were added.
///
/// Enumerated rather than discovered, because the failure worth catching is an artifact arriving
/// with no manifest at all: a loop over the manifests that exist would be green for exactly the
/// thing that has no gate. [`every_committed_binary_is_covered`] is the other half of that argument.
const ARMS: &[Arm] = &[
    Arm {
        name: "TypeScript (and the JavaScript arm, which shares this component)",
        manifest: "crates/gg/src/sandbox/guests/typescript.component.manifest.json",
        artifacts: &["crates/gg/src/sandbox/guests/typescript.component.wasm"],
        roots: &["packages/gg-sandbox/src"],
        // `tsconfig.json` decides what the build emits — together with the repository-wide
        // `tsconfig.base.json` it extends, which is where the emit-affecting options actually
        // live: the leaf restates none of `target`, `module`, `lib` or `useDefineForClassFields`
        // and inherits all four, and changing `target` alone was measured to change the emitted
        // JavaScript in eight files including `shim.js`, which is the file baked into this
        // component. That base file is edited for the web app and the docs site by people with no
        // reason to know this guest hangs off it. `package.json` pins the `typescript` release
        // that does the emitting, and `build.sh` is the recipe — the `--disable`s in it decide
        // whether this guest has a `fetch` at all.
        files: &[
            "packages/gg-sandbox/tsconfig.json",
            "tsconfig.base.json",
            "packages/gg-sandbox/package.json",
            "packages/gg-sandbox/build.sh",
        ],
        ignore: &[],
        pins: &[(
            "componentizeJs",
            "COMPONENTIZE_VERSION",
            "packages/gg-sandbox/build.sh",
        )],
        consequence: "Every TypeScript and JavaScript program in a run is evaluated by the \
         committed component, so its scope, its refusals and its argument handling would be last \
         build's while the catalogue and the prompt describe this checkout's.",
        rebuild: "packages/gg-sandbox/build.sh",
    },
    Arm {
        name: "Python",
        manifest: "crates/gg/src/sandbox/guests/python.component.manifest.json",
        artifacts: &["crates/gg/src/sandbox/guests/python.component.wasm"],
        roots: &["packages/gg-sandbox-python/src"],
        // The wheels the build vendors and bakes the import closure of, and the recipe that
        // vendors them.
        files: &[
            "packages/gg-sandbox-python/requirements.txt",
            "packages/gg-sandbox-python/build.sh",
        ],
        // CPython writes these beside the sources it imports, and a reflector run is enough to
        // create them. They are `.gitignore`d; hashing them would fail this test for having read a
        // file.
        ignore: &[
            "packages/gg-sandbox-python/src/__pycache__",
            "packages/gg-sandbox-python/src/gg/__pycache__",
        ],
        pins: &[(
            "componentizePy",
            "COMPONENTIZE_VERSION",
            "packages/gg-sandbox-python/build.sh",
        )],
        consequence: "Every Python program in a run is evaluated by the committed component, so \
         its scope, its refusals and its library set would be last build's while the catalogue \
         and the prompt describe this checkout's.",
        rebuild: "packages/gg-sandbox-python/build.sh",
    },
    Arm {
        name: "Ruby",
        manifest: "crates/gg/src/sandbox/guests/ruby.component.manifest.json",
        artifacts: &["crates/gg/src/sandbox/guests/ruby.component.wasm"],
        roots: &["packages/gg-sandbox-ruby/src"],
        // What lowers this arm's Ruby to the JavaScript the component bakes: a change here changes
        // the guest without a line of Ruby moving. `build.sh` is in for the same reason one step
        // further out — it is the recipe, and its `--disable`s decide what capabilities the
        // component is baked with.
        files: &[
            "packages/gg-sandbox-ruby/tools/guest.mjs",
            "packages/gg-sandbox-ruby/build.sh",
        ],
        ignore: &[],
        pins: &[
            (
                "componentizeJs",
                "COMPONENTIZE_VERSION",
                "packages/gg-sandbox-ruby/opal-version.sh",
            ),
            (
                "opalCompiler",
                "OPAL_COMPILER_VERSION",
                "packages/gg-sandbox-ruby/opal-version.sh",
            ),
            (
                "opalGem",
                "OPAL_VERSION",
                "packages/gg-sandbox-ruby/opal-version.sh",
            ),
        ],
        consequence: "Every Ruby program in a run is evaluated by the committed component, whose \
         SDK and library set are baked in at build time, so both would be last build's while the \
         catalogue and the prompt describe this checkout's.",
        rebuild: "packages/gg-sandbox-ruby/build.sh",
    },
    Arm {
        name: "Rust",
        manifest: "crates/gg/src/sandbox/checkers/rust.sources.manifest.json",
        artifacts: &["crates/gg/src/sandbox/checkers/rust.libraries.tar.gz"],
        roots: &["packages/gg-sandbox-rust/src"],
        // The curated set is what the first two say it is: which crates a model may name, and the
        // exact versions of them compiled into the archive. The third is what generates the
        // bindings this arm ignores below, and the fourth is the recipe itself.
        files: &[
            "packages/gg-sandbox-rust/Cargo.toml",
            "packages/gg-sandbox-rust/Cargo.lock",
            "packages/gg-sandbox-rust/bindings.sh",
            "packages/gg-sandbox-rust/build.sh",
        ],
        // The generated WIT bindings, which `packages/gg-sandbox-rust/.gitignore` excludes and no
        // commit carries. They exist only in a working tree where somebody ran `bindings.sh`, so
        // digesting them would fail this test on every fresh checkout — which is every CI checkout,
        // on both CI systems, neither of which runs that script. `bindings.sh` is recorded instead,
        // and it has to be: unlike the C++ and Swift arms' bindings steps, whose output the wire
        // digest and the `witBindgen` pin already pin between them, this one passes flags
        // (`--pub-export-macro`, `--default-bindings-module`, `--format`) that change `bindings.rs`
        // — and therefore `libgg.rlib` — without the WIT or the pin moving.
        ignore: &["packages/gg-sandbox-rust/src/bindings.rs"],
        // The `rustc` pin is deliberately not here: it is derived from `rust-toolchain.toml` rather
        // than written as a literal, and `rust.compile.test.rs` already fails when this checkout's
        // compiler is not the one that built the set — which is the stronger check, because it asks
        // the machine rather than a file.
        pins: &[
            (
                "target",
                "GG_RUST_TARGET",
                "packages/gg-sandbox-rust/rust-version.sh",
            ),
            (
                "witBindgen",
                "GG_WIT_BINDGEN_VERSION",
                "packages/gg-sandbox-rust/rust-version.sh",
            ),
        ],
        consequence: "Every Rust program in a run is compiled against `libgg.rlib` as it was \
         when the set was cut — an rlib carries no source anything here could compare — so a \
         model would be shown one surface and linked against another.",
        rebuild: "packages/gg-sandbox-rust/build.sh",
    },
    Arm {
        name: "Swift",
        manifest: "crates/gg/src/sandbox/checkers/swift.sources.manifest.json",
        artifacts: &[
            "crates/gg/src/sandbox/checkers/swift.guest.tar.gz",
            "crates/gg/src/sandbox/checkers/swift.libraries.tar.gz",
            "crates/gg/src/sandbox/checkers/swift.adapter.wasm",
        ],
        roots: &["packages/gg-sandbox-swift/Sources"],
        // The module list is a claim about the library archive and is what the catalogue's library
        // section is rendered from, so it belongs to the same rebuild — as does the recipe, which
        // holds the compile arguments and the `library` list that decides what goes in.
        files: &[
            "packages/gg-sandbox-swift/libraries.txt",
            "packages/gg-sandbox-swift/build.sh",
        ],
        ignore: &[],
        pins: &[
            (
                "swift",
                "GG_SWIFT_VERSION",
                "packages/gg-sandbox-swift/swift-version.sh",
            ),
            (
                "target",
                "GG_SWIFT_TARGET",
                "packages/gg-sandbox-swift/swift-version.sh",
            ),
            (
                "witBindgen",
                "GG_WIT_BINDGEN_VERSION",
                "packages/gg-sandbox-swift/swift-version.sh",
            ),
            (
                "adapter",
                "GG_WASMTIME_ADAPTER_VERSION",
                "packages/gg-sandbox-swift/swift-version.sh",
            ),
            (
                "swiftCollections",
                "GG_SWIFT_COLLECTIONS_VERSION",
                "packages/gg-sandbox-swift/swift-version.sh",
            ),
            (
                "swiftAlgorithms",
                "GG_SWIFT_ALGORITHMS_VERSION",
                "packages/gg-sandbox-swift/swift-version.sh",
            ),
            (
                "swiftNumerics",
                "GG_SWIFT_NUMERICS_VERSION",
                "packages/gg-sandbox-swift/swift-version.sh",
            ),
        ],
        consequence: "Every Swift program in a run is compiled against `gg.swiftmodule` and \
         `gg.o` as they were when the archive was cut, and neither carries source anything here \
         could compare, so a model would be shown one surface and compiled against another.",
        rebuild: "packages/gg-sandbox-swift/build.sh",
    },
    Arm {
        name: "C++",
        manifest: "crates/gg/src/sandbox/checkers/cpp.sources.manifest.json",
        artifacts: &[
            "crates/gg/src/sandbox/checkers/cpp.guest.tar.gz",
            "crates/gg/src/sandbox/checkers/cpp.adapter.wasm",
        ],
        roots: &["packages/gg-sandbox-cpp/Sources"],
        // The recipe, which holds the exception-handling and hardening flags this arm's own
        // `cpp.compile.rs` has to agree with — a change to either without a rebuild is a program
        // compiled one way and linked against an archive built another.
        files: &["packages/gg-sandbox-cpp/build.sh"],
        ignore: &[],
        pins: &[
            (
                "wasiSdk",
                "GG_WASI_SDK_VERSION",
                "packages/gg-sandbox-cpp/cpp-version.sh",
            ),
            (
                "target",
                "GG_CPP_TARGET",
                "packages/gg-sandbox-cpp/cpp-version.sh",
            ),
            (
                "std",
                "GG_CPP_STD",
                "packages/gg-sandbox-cpp/cpp-version.sh",
            ),
            (
                "witBindgen",
                "GG_WIT_BINDGEN_VERSION",
                "packages/gg-sandbox-cpp/cpp-version.sh",
            ),
            (
                "adapter",
                "GG_WASMTIME_ADAPTER_VERSION",
                "packages/gg-sandbox-cpp/cpp-version.sh",
            ),
        ],
        consequence: "Every C++ program in a run is declared against the archive's SDK headers \
         and linked against `sdk.o`; the headers are compared file for file by \
         cpp.compile.test.rs, so what a stale archive changes silently is what the SDK's bodies \
         DO.",
        rebuild: "packages/gg-sandbox-cpp/build.sh",
    },
];

/// The committed artifacts that are **not** in [`ARMS`], each with the gate that covers it instead.
///
/// Written out beside the reason, because "this one is covered elsewhere" is a claim that ages: an
/// artifact whose other gate is deleted should be re-argued here rather than quietly relying on a
/// sentence nobody re-read.
const COVERED_ELSEWHERE: &[(&str, &str)] = &[
    (
        "crates/gg/src/sandbox/guests/csharp.component.wasm",
        "csharp.manifest.test.rs compares checkers/csharp.toolchain.json against the SHA-256 of \
         this checkout's Sources/*.c, the component's own byte count, and every pin in \
         csharp-version.sh. This arm's C# SDK is not baked into the component at all — Roslyn \
         compiles it on the turn path — so no rebuild of this artifact can make the SDK stale.",
    ),
    (
        "crates/gg/src/sandbox/checkers/java.sdk.jar",
        "contract-drift.sh re-cuts this jar from packages/gg-sandbox-java/src on every run and \
         diffs it; the build is byte-reproducible (`jar --date`, sorted entries), so an SDK edit \
         committed without the jar fails there.",
    ),
    (
        "crates/gg/src/sandbox/checkers/kotlin.sdk.jar",
        "re-cut and diffed by contract-drift.sh on every run, on the same terms as the Java arm's.",
    ),
    (
        "crates/gg/src/sandbox/checkers/purescript.libraries.tar.gz",
        "purescript.compile.test.rs unpacks the tarball and compares its libs/gg-sdk/src with \
         packages/gg-sandbox-purescript/src file for file, the .js foreign modules included, and \
         purescript.compiler.json declares every package and module in the tree.",
    ),
];

/// The repository root, from this crate's own manifest directory.
///
/// Two levels up from `crates/gg`, resolved at compile time from a variable Cargo always sets, so
/// nothing here depends on the working directory a test runner happened to choose.
fn repository() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .expect("crates/gg sits two levels under the repository root")
        .to_path_buf()
}

/// One file's SHA-256, hex-encoded — the same digest `scripts/gg-artifact-manifest.mjs` wrote.
fn digest(path: &Path) -> String {
    let bytes =
        fs::read(path).unwrap_or_else(|error| panic!("reading {}: {error}", path.display()));
    format!("{:x}", Sha256::digest(&bytes))
}

/// Every file under `root`, by its repository-relative path, skipping `ignore`d directories.
///
/// Names only, and digested separately by the two callers that want digests, because the third
/// wants nothing but the names: [`every_committed_binary_is_covered`] walks two directories holding
/// 130 MB of committed binary, and hashing all of it to ask what is in them would make the cheapest
/// of these five tests the most expensive (measured: 4.7 s against 0.01 s).
fn walk(repository: &Path, root: &str, ignore: &[&str], found: &mut BTreeSet<String>) {
    let mut stack = vec![repository.join(root)];
    while let Some(dir) = stack.pop() {
        let entries =
            fs::read_dir(&dir).unwrap_or_else(|error| panic!("reading {}: {error}", dir.display()));
        for entry in entries {
            let entry = entry.expect("a directory entry");
            let path = entry.path();
            let relative = path
                .strip_prefix(repository)
                .expect("every walked path is under the repository")
                .to_string_lossy()
                .into_owned();
            if ignore
                .iter()
                .any(|skip| relative == *skip || relative.starts_with(&format!("{skip}/")))
            {
                continue;
            }
            if path.is_dir() {
                stack.push(path);
            } else {
                found.insert(relative);
            }
        }
    }
}

/// Those same files, each beside the SHA-256 of its bytes.
fn digests(repository: &Path, names: &BTreeSet<String>) -> BTreeMap<String, String> {
    names
        .iter()
        .map(|name| (name.clone(), digest(&repository.join(name))))
        .collect()
}

/// A digest over the WIT's **declarations**, deliberately blind to its documentation.
///
/// The other half of `wireDigest` in `scripts/gg-artifact-manifest.mjs`, and it must agree with it
/// line for line: the non-blank lines that do not begin a `//` comment, each trimmed, joined with
/// newlines under their file's repository-relative name.
///
/// Blind to the prose because `crates/gg/wit/gg-sandbox.wit` is gg's membrane *documentation* as
/// much as its interface — 858 of its 1,219 lines are comment — and a gate that demanded a 25 MB
/// rebuild for a reworded sentence would teach whoever hit it to regenerate the manifest without
/// rebuilding, which is the one habit that would make this whole mechanism worthless. What a guest
/// is built from is the declarations, and every one of these arms is built against them through
/// generated bindings no source digest here would otherwise see.
fn wire(repository: &Path, root: &str) -> String {
    let mut files = BTreeSet::new();
    walk(repository, root, &[], &mut files);
    let mut hash = Sha256::new();
    for name in &files {
        if !name.ends_with(".wit") {
            continue;
        }
        let text = fs::read_to_string(repository.join(name))
            .unwrap_or_else(|error| panic!("reading {name}: {error}"));
        let declarations: Vec<&str> = text
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty() && !line.starts_with("//"))
            .collect();
        hash.update(format!("{name}\n{}\n", declarations.join("\n")));
    }
    format!("{:x}", hash.finalize())
}

/// The value `variable` is assigned in a shell script, without the quotes.
///
/// Read as text for the reason the C# arm's manifest test reads its own pins that way: a shell
/// script is not a data format gg can parse, and the one value that matters is unambiguous to look
/// for.
fn pinned(repository: &Path, file: &str, variable: &str) -> String {
    let text = fs::read_to_string(repository.join(file))
        .unwrap_or_else(|error| panic!("reading {file}: {error}"));
    text.lines()
        .find_map(|line| {
            line.trim()
                .strip_prefix(&format!("{variable}=\""))?
                .strip_suffix('"')
        })
        .unwrap_or_else(|| panic!("{variable} is not pinned in {file}"))
        .to_string()
}

/// The manifest, parsed.
fn manifest(repository: &Path, arm: &Arm) -> Value {
    let text = fs::read_to_string(repository.join(arm.manifest))
        .unwrap_or_else(|error| panic!("reading {}: {error}", arm.manifest));
    serde_json::from_str(&text).expect("an artifact manifest is valid JSON")
}

#[test]
fn each_manifest_describes_the_artifacts_that_are_actually_committed() {
    let repository = repository();
    for arm in ARMS {
        let manifest = manifest(&repository, arm);
        let described = manifest["artifacts"]
            .as_object()
            .expect("the manifest describes its artifacts");
        let named: BTreeSet<&str> = described.keys().map(String::as_str).collect();
        let expected: BTreeSet<&str> = arm.artifacts.iter().copied().collect();
        assert_eq!(
            named, expected,
            "{}: {} does not describe the artifacts this arm commits — an artifact dropped from a \
             manifest is one nothing checks",
            arm.name, arm.manifest
        );
        for (artifact, recorded) in described {
            let path = repository.join(artifact);
            let bytes = fs::metadata(&path)
                .unwrap_or_else(|error| panic!("stat {artifact}: {error}"))
                .len();
            assert_eq!(
                recorded["bytes"].as_u64(),
                Some(bytes),
                "{}: {artifact} and {} were not written by the same run of {} — re-run it and \
                 commit both",
                arm.name,
                arm.manifest,
                arm.rebuild
            );
            assert_eq!(
                recorded["sha256"].as_str().unwrap_or_default(),
                digest(&path),
                "{}: {artifact} and {} were not written by the same run of {} — re-run it and \
                 commit both",
                arm.name,
                arm.manifest,
                arm.rebuild
            );
        }
    }
}

#[test]
fn each_committed_artifact_was_built_from_this_checkouts_sources() {
    let repository = repository();
    for arm in ARMS {
        let manifest = manifest(&repository, arm);
        let declared: BTreeMap<String, String> = manifest["sources"]
            .as_object()
            .expect("the manifest carries a source digest table")
            .iter()
            .map(|(path, digest)| {
                (
                    path.clone(),
                    digest.as_str().unwrap_or_default().to_string(),
                )
            })
            .collect();
        let mut names = BTreeSet::new();
        for root in arm.roots {
            walk(&repository, root, arm.ignore, &mut names);
        }
        for file in arm.files {
            names.insert((*file).to_string());
        }
        let present = digests(&repository, &names);

        // Reported as a difference rather than as two maps, because the two maps are twenty entries
        // each and the reader's next question is always *which file*. All three directions are
        // failures and for the same reason: a source added to an SDK and never built in is as
        // absent from the artifact as an edited one is stale in it, and a source deleted without a
        // rebuild leaves the artifact carrying something no longer in the tree.
        let mut changed: Vec<String> = Vec::new();
        for (path, digest) in &present {
            match declared.get(path) {
                None => changed.push(format!("  added since the build:   {path}")),
                Some(recorded) if recorded != digest => {
                    changed.push(format!("  edited since the build:  {path}"));
                }
                Some(_) => {}
            }
        }
        for path in declared.keys() {
            if !present.contains_key(path) {
                changed.push(format!("  deleted since the build: {path}"));
            }
        }
        assert!(
            changed.is_empty(),
            "{}: {} source(s) no longer match the committed artifacts. {}\n{}\nRe-run {} and \
             commit the artifacts and their manifest together.",
            arm.name,
            changed.len(),
            arm.consequence,
            changed.join("\n"),
            arm.rebuild
        );
    }
}

#[test]
fn each_committed_artifact_was_built_against_this_checkouts_wire() {
    let repository = repository();
    let declarations = wire(&repository, "crates/gg/wit");

    // Every stale arm, rather than whichever the loop reached first: there is one wire and all six
    // are built against it, so a changed declaration invalidates all six at once and a failure that
    // named one would send whoever hit it back six times.
    let mut stale: Vec<&str> = Vec::new();
    for arm in ARMS {
        let manifest = manifest(&repository, arm);
        let root = manifest["wit"]["root"]
            .as_str()
            .expect("the manifest names the WIT it was built against");
        assert_eq!(
            root, "crates/gg/wit",
            "{}: there is one copy of the wire and it is crates/gg/wit",
            arm.name
        );
        if manifest["wit"]["declarationsSha256"]
            .as_str()
            .unwrap_or_default()
            != declarations
        {
            stale.push(arm.rebuild);
        }
    }
    assert!(
        stale.is_empty(),
        "the membrane's declarations in crates/gg/wit have changed since {} of gg's hand-built \
         artifacts were cut. Every one of them embeds bindings generated from that WIT, so a \
         renamed function or a changed parameter reaches a program only after a rebuild. Re-run:\n\
         {}\n(A documentation-only edit to the WIT is deliberately NOT this failure — see `wire`.)",
        stale.len(),
        stale
            .iter()
            .map(|rebuild| format!("  {rebuild}"))
            .collect::<Vec<_>>()
            .join("\n")
    );
}

#[test]
fn each_committed_artifact_was_built_at_the_versions_this_checkout_pins() {
    let repository = repository();
    for arm in ARMS {
        let manifest = manifest(&repository, arm);
        for (field, variable, file) in arm.pins {
            assert_eq!(
                manifest["pins"][field].as_str().unwrap_or_default(),
                pinned(&repository, file, variable),
                "{}: the committed artifacts' {field} is not what {variable} pins in {file} — \
                 re-run {}",
                arm.name,
                arm.rebuild
            );
        }
    }
}

/// The committed files under those two directories that `scripts/ci/contract-drift.sh` re-cuts from
/// their sources on every CI run and diffs, each beside the step that does it.
///
/// A diff is a *stronger* check than a digest — it shows what changed rather than only that
/// something did — so nothing here wants a manifest. What each entry is doing is **making the claim
/// visible**: `ruby.opal.cjs` is 2.8 MB of generated JavaScript no reviewer reads, and the only
/// thing standing between it and the same silent staleness [`ARMS`] exists for is one step in a
/// shell script. That was true before this list and written down nowhere.
const RECUT_BY_CONTRACT_DRIFT: &[(&str, &str)] = &[
    // The eleven catalogues, re-reflected from each arm's own SDK by the loop over
    // `guests/*.signatures.json` in contract-drift.sh and diffed. A catalogue that no longer
    // matches its SDK fails there by language id.
    (
        "crates/gg/src/sandbox/guests/cpp.signatures.json",
        CATALOGUE,
    ),
    (
        "crates/gg/src/sandbox/guests/csharp.signatures.json",
        CATALOGUE,
    ),
    (
        "crates/gg/src/sandbox/guests/java.signatures.json",
        CATALOGUE,
    ),
    (
        "crates/gg/src/sandbox/guests/javascript.signatures.json",
        CATALOGUE,
    ),
    (
        "crates/gg/src/sandbox/guests/kotlin.signatures.json",
        CATALOGUE,
    ),
    (
        "crates/gg/src/sandbox/guests/purescript.signatures.json",
        CATALOGUE,
    ),
    (
        "crates/gg/src/sandbox/guests/python.signatures.json",
        CATALOGUE,
    ),
    (
        "crates/gg/src/sandbox/guests/ruby.signatures.json",
        CATALOGUE,
    ),
    (
        "crates/gg/src/sandbox/guests/rust.signatures.json",
        CATALOGUE,
    ),
    (
        "crates/gg/src/sandbox/guests/swift.signatures.json",
        CATALOGUE,
    ),
    (
        "crates/gg/src/sandbox/guests/typescript.signatures.json",
        CATALOGUE,
    ),
    // The Ruby arm's compiled Opal runtime: 2.8 MB of generated JavaScript, re-cut by
    // contract-drift.sh through packages/gg-sandbox-ruby/compiler.sh and diffed. It is the one
    // TEXT artifact here that no reviewer could read, and it is safe for that step alone.
    (
        "crates/gg/src/sandbox/checkers/ruby.opal.cjs",
        "contract-drift.sh re-cuts it through packages/gg-sandbox-ruby/compiler.sh and diffs it.",
    ),
    // The TypeScript checker, its standard library and the globals a program may name: all three
    // cut from the pinned `typescript` release by contract-drift.sh's checker step and diffed.
    (
        "crates/gg/src/sandbox/checkers/typescript.tsc.js",
        "contract-drift.sh re-cuts it from the `typescript` release package.json pins, and diffs.",
    ),
    (
        "crates/gg/src/sandbox/checkers/typescript.lib.d.ts",
        "cut from the same pinned release by the same step, and diffed.",
    ),
    (
        "crates/gg/src/sandbox/checkers/typescript.globals.d.ts",
        "cut by the same step out of packages/gg-sandbox/tools/program-globals.d.ts, and diffed.",
    ),
    (
        "crates/gg/src/sandbox/checkers/typescript.checker.json",
        "written by the same step and diffed; it names which compiler, at which level.",
    ),
    // The manifests that are not cut from anything: gg's own hand-written compiler drivers and the
    // per-arm toolchain declarations. Every one of them is reviewable BY READING, which is what
    // makes a diff enough and a digest pointless — and each has a Rust test of its own holding it
    // to the shell script that installs the toolchain it names.
    ("crates/gg/src/sandbox/checkers/java.compiler.java", DRIVER),
    ("crates/gg/src/sandbox/checkers/jvm.backend.java", DRIVER),
    (
        "crates/gg/src/sandbox/checkers/kotlin.compiler.java",
        DRIVER,
    ),
    (
        "crates/gg/src/sandbox/checkers/java.toolchain.json",
        DECLARED,
    ),
    (
        "crates/gg/src/sandbox/checkers/kotlin.toolchain.json",
        DECLARED,
    ),
    (
        "crates/gg/src/sandbox/checkers/csharp.toolchain.json",
        DECLARED,
    ),
    (
        "crates/gg/src/sandbox/checkers/rust.toolchain.json",
        DECLARED,
    ),
    (
        "crates/gg/src/sandbox/checkers/swift.toolchain.json",
        DECLARED,
    ),
    (
        "crates/gg/src/sandbox/checkers/cpp.toolchain.json",
        DECLARED,
    ),
    (
        "crates/gg/src/sandbox/checkers/purescript.compiler.json",
        DECLARED,
    ),
    (
        "crates/gg/src/sandbox/checkers/ruby.compiler.json",
        DECLARED,
    ),
];

/// Why a signature catalogue needs nothing from this file.
const CATALOGUE: &str = "contract-drift.sh re-reflects every guests/*.signatures.json out of its own SDK on every run \
     and diffs it, which is stronger than a digest: it shows what changed.";

/// Why gg's own hand-written compiler drivers need nothing from this file.
const DRIVER: &str = "gg's own hand-written compiler driver. Nothing cuts it from anything, it is \
     reviewable by reading, and what could go wrong in it is asserted over its text by that arm's \
     compile test rather than by any digest.";

/// Why a per-arm toolchain declaration needs nothing from this file.
const DECLARED: &str = "a declaration rather than an output: it says what an artifact was built \
     BY and what is in it, is reviewable by reading, and is held to the shell script that installs \
     that toolchain — and to the artifact's own contents — by that arm's compile or manifest test.";

/// **Nothing gg carries is left without a gate** — the check that makes the enumeration above safe.
///
/// [`ARMS`] is written out rather than discovered, which closes the hole where a manifest is deleted
/// and its arm silently stops being checked, and opens the one where a *seventh* artifact arrives
/// with no manifest at all. This closes that one.
///
/// # Why it is an allowlist rather than a list of suffixes
///
/// It used to ask only about `.wasm`, `.tar.gz` and `.jar`, on the argument that everything else in
/// these two directories is text a `contract-drift.sh` diff covers. The argument is right and the
/// enforcement was not: a `.dll`, a `.zip`, a `.a`, a `.wasm.gz` or a bundled `.js` from an arm
/// added later matched no suffix and got no gate — measured, by writing three such files into these
/// directories and watching this test pass. gg already commits the counterexample in text:
/// `checkers/ruby.opal.cjs` is 2.8 MB of generated JavaScript nobody reads, safe only because one
/// step in a shell script re-cuts it.
///
/// So the rule is inverted. **Every** file gg embeds from must be argued: described by one of
/// [`ARMS`]' manifests, or named in [`COVERED_ELSEWHERE`] with the gate that covers it, or named in
/// [`RECUT_BY_CONTRACT_DRIFT`] with the step that re-cuts it. A new file has to be put in one of the
/// three, which means somebody has to say which — and that sentence is the whole value of this test.
#[test]
fn every_committed_artifact_is_covered() {
    let repository = repository();
    let mut covered: BTreeMap<String, &'static str> = BTreeMap::new();
    for (path, why) in COVERED_ELSEWHERE {
        covered.insert((*path).to_string(), why);
    }
    for (path, why) in RECUT_BY_CONTRACT_DRIFT {
        covered.insert((*path).to_string(), why);
    }
    for arm in ARMS {
        for artifact in arm.artifacts {
            covered.insert((*artifact).to_string(), arm.name);
        }
        // The manifests themselves, which are as committed as what they describe. They need no
        // second gate: the four tests above read every one of them, so a manifest that stopped
        // matching its arm is already a failure by name.
        covered.insert(arm.manifest.to_string(), arm.name);
    }

    let mut present = BTreeSet::new();
    walk(
        &repository,
        "crates/gg/src/sandbox/guests",
        &[],
        &mut present,
    );
    walk(
        &repository,
        "crates/gg/src/sandbox/checkers",
        &[],
        &mut present,
    );
    let uncovered: Vec<&String> = present
        .iter()
        .filter(|path| !covered.contains_key(*path))
        .collect();
    assert!(
        uncovered.is_empty(),
        "{} committed file(s) under gg's two artifact directories are covered by nothing:\n{}\n\
         Every file gg embeds from has to be argued. Add its arm to ARMS with a manifest its \
         build.sh writes; or name it in RECUT_BY_CONTRACT_DRIFT beside the contract-drift.sh step \
         that re-cuts it from its sources; or name it in COVERED_ELSEWHERE and say which gate does \
         cover it.",
        uncovered.len(),
        uncovered
            .iter()
            .map(|path| format!("  {path}"))
            .collect::<Vec<_>>()
            .join("\n")
    );

    // And the reverse, so the three lists cannot rot into a blanket waiver: an entry naming a file
    // that is no longer committed is a claim about nothing, and the next reader would take it for a
    // live one.
    let stale: Vec<&String> = covered
        .keys()
        .filter(|path| !present.contains(*path))
        .collect();
    assert!(
        stale.is_empty(),
        "{} entr(ies) in ARMS, COVERED_ELSEWHERE or RECUT_BY_CONTRACT_DRIFT name a file that is \
         not committed any more:\n{}\nDelete the entry with the file.",
        stale.len(),
        stale
            .iter()
            .map(|path| format!("  {path}"))
            .collect::<Vec<_>>()
            .join("\n")
    );
}
