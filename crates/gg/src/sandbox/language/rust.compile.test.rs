//! The Rust compile's own units: the two halves of the toolchain agreeing about which compiler they
//! were built by, and the classifier's verdict on a report that never came from one.

use std::process::Command;

use super::*;

/// **The committed library set was built by this checkout's compiler.**
///
/// The one gate that catches the arm's most awkward coupling, and it is deliberately loud. An
/// `.rlib` is a compiler-version-private format: `rustc` refuses one built by any other release
/// outright, with `E0514`. So bumping `rust-toolchain.toml` invalidates
/// `checkers/rust.libraries.tar.gz`, and the two must move in the same commit.
///
/// Failing here on the commit that bumps the compiler is the point. The alternative is a gg binary
/// that builds, ships, reaches a run container, and refuses **every Rust program in the run** over
/// gg's own library files — a failure that costs a whole run to discover and reads, to whoever finds
/// it, like a compiler problem rather than a build-order one.
///
/// It compares against `rustc --version` rather than against `rust-toolchain.toml`, because what a
/// compile will actually use is a compiler rather than a file: a machine whose `rustc` is not the
/// pinned one has the problem this describes whatever the pin says.
#[test]
fn the_committed_library_set_was_built_by_this_checkouts_compiler() {
    // Deliberately `Command`, and this file is exempt from the seam's source-level ban on it (the
    // gate exempts `.test.rs`): this asks the machine a question about its toolchain rather than
    // compiling anything, so there is no preparation for it to be isolated from.
    let observed = Command::new("rustc")
        .arg("--version")
        .output()
        .expect("a checkout of this repository has rustc on PATH");
    let observed = String::from_utf8_lossy(&observed.stdout);
    let observed = observed
        .split_whitespace()
        .nth(1)
        .expect("`rustc --version` prints `rustc <version> (…)`");

    assert_eq!(
        observed,
        compiler_version(),
        "the committed Rust library set was built by rustc {}, and this checkout's rustc is \
         {observed}. An .rlib cannot be read by another release, so every Rust program would be \
         refused over gg's own library files. Re-run packages/gg-sandbox-rust/build.sh.",
        compiler_version(),
    );
}

/// **The manifest and the tarball describe the same set.**
///
/// The manifest is what `--extern` is built from, so a crate named there and absent from the archive
/// is a link failure on every program, and a crate in the archive and absent from the manifest is a
/// library a program silently cannot reach.
#[test]
fn the_manifest_names_exactly_what_the_tarball_carries() {
    let mut archived: Vec<String> =
        tar::Archive::new(flate2::read::GzDecoder::new(LIBRARIES_TAR_GZ))
            .entries()
            .expect("the committed library set is a readable tar")
            .filter_map(|entry| {
                let path = entry.ok()?.path().ok()?.to_string_lossy().into_owned();
                let name = path.rsplit('/').next()?.to_string();
                name.strip_prefix("lib")?.strip_suffix(".rlib")?;
                Some(
                    name.trim_start_matches("lib")
                        .trim_end_matches(".rlib")
                        .to_string(),
                )
            })
            .collect();
    archived.sort();

    let mut declared: Vec<String> = manifest()
        .crates
        .iter()
        .map(|library| library.name.clone())
        .collect();
    declared.sort();

    assert_eq!(
        declared, archived,
        "the committed manifest and the committed library set disagree about what a program is \
         compiled against; re-run packages/gg-sandbox-rust/build.sh"
    );
    assert!(
        declared.iter().any(|name| name == "gg"),
        "the library set carries no `gg` crate, which is the one every program names"
    );
}

/// **The target is the one whose imports the language chooses rather than the target.**
///
/// `wasm32-wasip2` would also produce a component, and would import `wasi:cli` and `wasi:io` whether
/// or not a program touched either — because the target's own start-up does. gg links the whole WASI
/// surface, so it would work; what it would mean is that the **target** decided a Rust program begins
/// by initialising a WASI environment, on an arm whose whole point is to compare languages.
#[test]
fn a_program_is_compiled_to_the_target_the_arm_chose() {
    assert_eq!(target(), "wasm32-unknown-unknown");
}

/// **A compiler that said nothing is a toolchain failure, not the model's.**
///
/// The one classification that cannot be exercised through a real `rustc` — it means a compiler
/// exited non-zero and emitted no diagnostic at all, which a working one does not do — and the one
/// where getting it wrong is worst: reported as the model's, it sends a model rewriting a program
/// that was never wrong.
#[test]
fn a_failure_with_no_diagnostic_is_not_blamed_on_the_model() {
    let failure = classify(
        &CompilerReport {
            ok: false,
            code: Some(101),
            status: "exited with status 101".to_string(),
            stdout: String::new(),
            stderr: "error: internal compiler error: broken MIR\n".to_string(),
        },
        PROGRAM_FILE,
        40,
    )
    .expect_err("a compiler that reported nothing structured is a failure");
    let PrepareFailure::Toolchain(reported) = &failure else {
        panic!("a compiler crash was blamed on the model: {failure}");
    };
    assert!(reported.contains("exited with status 101"), "{reported}");
    assert!(reported.contains("broken MIR"), "{reported}");

    // And a compiler that exited zero decided nothing at all.
    classify(
        &CompilerReport {
            ok: true,
            code: Some(0),
            status: "exited with status 0".to_string(),
            stdout: String::new(),
            stderr: String::new(),
        },
        PROGRAM_FILE,
        40,
    )
    .expect("a clean compile is not a failure");
}

/// **A diagnostic outside the model's own file is still shown, and still not given a line.**
///
/// A `rustc` error whose only span is inside gg's wrapper or inside the library set is gg's artifact
/// rather than the model's program. Withholding it would leave the model with "your program did not
/// compile" and nothing else; inventing a line for it would point at whichever of the model's lines
/// shares the number.
#[test]
fn a_diagnostic_in_ggs_own_wrapper_is_reported_without_a_location() {
    let failure = classify(
        &CompilerReport {
            ok: false,
            code: Some(1),
            status: "exited with status 1".to_string(),
            stdout: String::new(),
            stderr: serde_json::json!({
                "level": "error",
                "message": "cannot find crate `gg`",
                "code": { "code": "E0463" },
                "spans": [{
                    "file_name": "/gg/lib/libgg.rlib",
                    "is_primary": true,
                    "line_start": 4,
                    "column_start": 9,
                    "label": null,
                }],
                "children": [],
            })
            .to_string(),
        },
        PROGRAM_FILE,
        40,
    )
    .expect_err("a diagnostic is a failure");
    let PrepareFailure::Program(PrepareError::Compile(rendered)) = &failure else {
        panic!("expected a compile error: {failure}");
    };
    assert!(rendered.contains("E0463"), "{rendered}");
    assert!(
        !rendered.contains("-->"),
        "a diagnostic outside the model's file was given a location: {rendered}"
    );
}

/// **A `rustc` line that is not a diagnostic is skipped, not treated as unreadable output.**
///
/// `--error-format=json` writes one object per line, and a toolchain is entitled to write something
/// else to stderr beside them (a linker's warning, a `note:` from a wrapper script). Treating the
/// whole stream as unreadable because one line was would turn a real, located type error into "gg
/// could not read the compiler's diagnostics".
#[test]
fn a_non_json_line_beside_the_diagnostics_is_ignored() {
    let failure = classify(
        &CompilerReport {
            ok: false,
            code: Some(1),
            status: "exited with status 1".to_string(),
            stdout: String::new(),
            stderr: format!(
                "warning: some wrapper wrote prose here\n{}\n",
                serde_json::json!({
                    "level": "error",
                    "message": "mismatched types",
                    "code": { "code": "E0308" },
                    "spans": [{
                        "file_name": PROGRAM_FILE,
                        "is_primary": true,
                        "line_start": 6,
                        "column_start": 18,
                        "label": "expected `u32`, found `&str`",
                    }],
                    "children": [{
                        "level": "help",
                        "message": "consider parsing it",
                        "code": null,
                        "spans": [],
                        "children": [],
                    }],
                })
            ),
        },
        PROGRAM_FILE,
        40,
    )
    .expect_err("a type error is a failure");
    let rendered = failure.to_string();
    assert!(
        rendered.contains("error[E0308]: mismatched types"),
        "{rendered}"
    );
    // Line 6 of the file is line 5 of the model's program.
    assert!(rendered.contains("--> line 5, column 18"), "{rendered}");
    assert!(
        rendered.contains("expected `u32`, found `&str`"),
        "{rendered}"
    );
    assert!(rendered.contains("help: consider parsing it"), "{rendered}");
}
