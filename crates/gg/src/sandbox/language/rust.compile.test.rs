//! The Rust compile's own units: the two halves of this arm's build agreeing about what a program
//! links against, and the classifier's verdict on a report that never came from a compiler.

use super::*;

// The compiler coupling is not asserted here. An `.rlib` is a compiler-version-private format,
// `rustc` refuses one built by any other release with `E0514`, and a mismatched set grounds EVERY
// Rust program in a run over gg's own library files — but the set is cut by
// `crates/gg-sandbox-artifacts/rust`, from the same `cargo build` that compiles this crate, with
// `rust-toolchain.toml` in that arm's rerun set, so a bump re-cuts the rlibs before anything can
// link against them. `packages/gg-sandbox-rust/build.sh` refuses to build at all when the `rustc` on
// PATH is not what `rust-toolchain.toml` pins, which asks the machine before producing anything
// rather than after.

/// **The manifest and the tarball describe the same set.**
///
/// The manifest is what `--extern` is built from, so a crate named there and absent from the archive
/// is a link failure on every program, and a crate in the archive and absent from the manifest is a
/// library a program silently cannot reach.
///
/// This is an AGREEMENT check between two things one run of `packages/gg-sandbox-rust/build.sh`
/// produces — the staged rlibs and the manifest it writes from the same staging directory — and it
/// stayed when the drift checks around it went, because that is a different question from "is the
/// committed copy current?". What it catches is a build script whose two halves came apart: a crate
/// staged and not declared, or declared and not staged.
#[test]
fn the_manifest_names_exactly_what_the_tarball_carries() {
    let mut archived: Vec<String> =
        tar::Archive::new(flate2::read::GzDecoder::new(LIBRARIES_TAR_GZ))
            .entries()
            .expect("the library set this build cut is a readable tar")
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
        "rust.toolchain.json and rust.libraries.tar.gz disagree about what a program is compiled \
         against, and one run of packages/gg-sandbox-rust/build.sh wrote both"
    );
    assert!(
        declared.iter().any(|name| name == "gg"),
        "the library set carries no `gg` crate, which is the one every program names"
    );
}

/// **The target is the one a failure can be read out of.**
///
/// `wasm32-wasip1` is what gives a program a standard error at all: on `wasm32-unknown-unknown`,
/// which this arm used to target, std's stdio falls through to `unsupported.rs`, where a write
/// discards its bytes and reports success — so a `main` returning `Err` produced a clean turn with
/// the message gone, and an `exit` produced a bare trap. Not `wasm32-wasip2`, which emits a
/// component through a `wasm-component-ld` bundling a `wasm-encoder` gg does not version; the p1
/// module is encoded in gg's own process with the pinned reactor adapter instead.
#[test]
fn a_program_is_compiled_to_the_target_a_failure_can_be_read_out_of() {
    assert_eq!(target(), "wasm32-wasip1");
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
/// A `rustc` error whose only span is inside the library set, or inside a code module linked beside
/// the program, is somebody else's file. Withholding it would leave the model with "your program
/// did not compile" and nothing else; inventing a line for it would point at whichever of the
/// model's lines shares the number.
#[test]
fn a_diagnostic_outside_the_models_own_file_is_reported_without_a_location() {
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
    // Line 6 of the file is line 6 of the model's program: gg subtracts nothing.
    assert!(rendered.contains("--> line 6, column 18"), "{rendered}");
    assert!(
        rendered.contains("expected `u32`, found `&str`"),
        "{rendered}"
    );
    assert!(rendered.contains("help: consider parsing it"), "{rendered}");
}

/// One `rustc` JSON diagnostic naming `nope<index>` at line `index + 1` of the model's own file,
/// with the `help` child every real one of these carries.
///
/// A distinct message *and* a distinct line, so the [bound](crate::sandbox::language::diagnostics)
/// has nothing to de-duplicate and what a test counts is the cap rather than the fold.
fn unresolved(index: usize) -> String {
    serde_json::json!({
        "level": "error",
        "message": format!("cannot find function `nope{index}` in this scope"),
        "code": { "code": "E0425" },
        "spans": [{
            "file_name": PROGRAM_FILE,
            "is_primary": true,
            "line_start": index + 1,
            "column_start": 5,
            "label": "not found in this scope",
        }],
        "children": [{
            "level": "help",
            "message": "consider importing it",
            "code": null,
            "spans": [],
            "children": [],
        }],
    })
    .to_string()
}

/// A report carrying `count` of them, as `rustc` writes them: one JSON object per line of stderr.
fn unresolved_report(count: usize) -> CompilerReport {
    CompilerReport {
        ok: false,
        code: Some(1),
        status: "exited with status 1".to_string(),
        stdout: String::new(),
        stderr: (0..count).map(unresolved).collect::<Vec<_>>().join("\n"),
    }
}

/// The `Compile` rendering `classify` produces for such a report.
fn compile_text(count: usize) -> String {
    let failure = classify(&unresolved_report(count), PROGRAM_FILE, 400)
        .expect_err("unresolved names are a failure");
    let PrepareFailure::Program(PrepareError::Compile(rendered)) = failure else {
        panic!("unresolved names are a compile error");
    };
    rendered
}

/// **A refusal the model can read whole is unchanged.**
///
/// The bound is a ceiling, not a filter: below it the model reads exactly the text this arm has
/// always rendered — every diagnostic, in `rustc`'s own order, joined by a blank line, with no
/// closing line about what was not shown, because nothing was not shown.
#[test]
fn a_refusal_under_the_bound_is_rendered_exactly_as_it_always_was() {
    let rendered = compile_text(SHOWN);

    // Byte for byte what the unbounded join produced: the same renderings, the same separator.
    let expected: Vec<String> = (0..SHOWN)
        .map(|index| {
            format!(
                "error[E0425]: cannot find function `nope{index}` in this scope\n  --> line {}, \
                 column 5\n  not found in this scope\n  help: consider importing it",
                index + 1
            )
        })
        .collect();
    assert_eq!(rendered, expected.join("\n\n"));
    assert!(
        !rendered.contains("more like these"),
        "a refusal that fitted was told it had been cut: {rendered}"
    );
}

/// **Past the bound the model reads the first few and an honest count of the rest.**
///
/// Fifty unresolved names is one mistake reported fifty times — the measurement this arm's
/// [`SHOWN`] was set from — and what the model needs from the forty-second copy is that it exists,
/// not what it says.
#[test]
fn a_refusal_past_the_bound_keeps_the_first_few_and_counts_the_rest() {
    let rendered = compile_text(50);

    assert!(
        rendered.contains("`nope0`") && rendered.contains(&format!("`nope{}`", SHOWN - 1)),
        "the first {SHOWN} diagnostics are what the model reads: {rendered}"
    );
    assert!(
        !rendered.contains(&format!("`nope{SHOWN}`")),
        "a diagnostic past the bound was shown: {rendered}"
    );
    assert!(
        rendered.ends_with(&format!("\n\n… and {} more like these.", 50 - SHOWN)),
        "the count is the honest one, on the arm's own separator: {rendered}"
    );

    // The kept diagnostics are whole — location, label and `rustc`'s suggestion — rather than a
    // list of headlines. What the bound drops is diagnostics, never parts of one.
    assert!(rendered.contains("--> line 1, column 5"), "{rendered}");
    assert!(
        rendered.contains("help: consider importing it"),
        "{rendered}"
    );

    // And it really is a bound: fifty diagnostics is 5982 bytes uncapped on this arm.
    assert!(
        rendered.len() < 1500,
        "the bound did not bound anything: {} bytes",
        rendered.len()
    );
}

/// **The bound cannot move a verdict from one band to the other.**
///
/// Whose failure a `rustc` invocation is gets decided on the whole of what it said, before a byte is
/// rendered: any error at all is the model's [`Compile`](PrepareError::Compile), and no error at all
/// is a [`Toolchain`](PrepareFailure::Toolchain) failure the model is never shown. Capping happens
/// after both, so no number of diagnostics can turn one into the other.
#[test]
fn the_bound_does_not_decide_whose_failure_it_is() {
    // Far past the bound, and still the model's own compile error.
    assert!(matches!(
        classify(&unresolved_report(200), PROGRAM_FILE, 400),
        Err(PrepareFailure::Program(PrepareError::Compile(_)))
    ));

    // And a stream of non-errors past the bound is still nobody's compile error: the band was
    // decided by there being no `error` in it, not by how much of it there was.
    let warnings = CompilerReport {
        ok: false,
        code: Some(1),
        status: "exited with status 1".to_string(),
        stdout: String::new(),
        stderr: (0..50)
            .map(|index| {
                serde_json::json!({
                    "level": "warning",
                    "message": format!("unused variable: `x{index}`"),
                    "code": null,
                    "spans": [],
                    "children": [],
                })
                .to_string()
            })
            .collect::<Vec<_>>()
            .join("\n"),
    };
    let failure = classify(&warnings, PROGRAM_FILE, 400).expect_err("a non-zero exit is a failure");
    assert!(
        matches!(failure, PrepareFailure::Toolchain(_)),
        "a compiler that reported no error was blamed on the model: {failure}"
    );
}
