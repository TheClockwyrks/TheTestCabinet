//! What the Swift arm knows without running a compiler: what it carries, what it says it carries,
//! and how it reads a finished `swiftc`.
//!
//! The compiler's own behaviour is [`substrate`](super::super::swift::substrate)'s subject; nothing
//! here spawns a process.

use super::*;

/// A finished-compiler report with the two fields classification reads.
fn report(ok: bool, stderr: &str) -> CompilerReport {
    CompilerReport {
        ok,
        code: if ok { Some(0) } else { Some(1) },
        status: match ok {
            true => "exited with status 0".to_string(),
            false => "exited with status 1".to_string(),
        },
        stdout: String::new(),
        stderr: stderr.to_string(),
    }
}

#[test]
fn the_committed_archive_holds_exactly_what_its_manifest_declares() {
    // The manifest is what an operator reads and what the shared-directory key is derived beside;
    // an archive that lost a file would otherwise fail as a `swiftc` error about a missing input,
    // three layers down from the thing that was actually wrong.
    let guest = guest().expect("the committed Swift guest unpacks");
    for name in guest_files() {
        let path = guest.file(name);
        let placed = std::fs::metadata(&path)
            .unwrap_or_else(|error| panic!("{name} is not in the unpacked guest: {error}"));
        let declared = manifest()
            .files
            .iter()
            .find(|file| file.name == name)
            .expect("the name came from the manifest");
        assert_eq!(
            placed.len(),
            declared.bytes,
            "{name} in the committed archive is not the size its manifest declares"
        );
    }
}

#[test]
fn the_committed_archive_is_placed_read_only() {
    // The seam's rule for a shared toolchain directory, asserted rather than assumed: `swiftc`
    // reads these files and must never be able to write beside them, because a shared tree a
    // compilation writes into is the measured `purs` corruption exactly.
    let guest = guest().expect("the committed Swift guest unpacks");
    let path = guest.file("shell.swift");
    let metadata = std::fs::metadata(&path).expect("the shell is in the unpacked guest");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            metadata.permissions().mode() & 0o222,
            0,
            "{} is writable inside a shared toolchain directory",
            path.display()
        );
    }
}

#[test]
fn the_shell_gg_compiles_beside_every_program_is_the_one_this_checkout_committed() {
    // The archive is built from `packages/gg-sandbox-swift/Sources` and committed; a checkout that
    // edited the shell without rebuilding would compile every program against the old one, and
    // nothing else would say so. Compared by content rather than by size so a same-length edit is
    // caught too.
    let guest = guest().expect("the committed Swift guest unpacks");
    let committed = std::fs::read_to_string(guest.file("shell.swift")).expect("the shell unpacks");
    let source = include_str!("../../../../../packages/gg-sandbox-swift/Sources/shell.swift");
    assert_eq!(
        committed, source,
        "crates/gg/src/sandbox/checkers/swift.guest.tar.gz is stale — run \
         packages/gg-sandbox-swift/build.sh and commit it"
    );
    let header = std::fs::read_to_string(guest.file("gg-shell.h")).expect("the header unpacks");
    let header_source = include_str!("../../../../../packages/gg-sandbox-swift/Sources/gg-shell.h");
    assert_eq!(
        header, header_source,
        "the committed bridging header is not this checkout's"
    );
}

#[test]
fn a_compiler_that_said_nothing_is_never_reported_as_the_models_failure() {
    // The band the study needs kept apart: `swiftc` 6.3.3 aborts on some programs, and a crash
    // reported as "your program did not compile" sends a model rewriting a program that was never
    // wrong.
    match classify(&report(false, "")) {
        Err(PrepareFailure::Toolchain(message)) => {
            assert!(
                message.contains("swiftc 6.3.3"),
                "a toolchain failure did not name the compiler: {message}"
            );
        }
        other => {
            panic!("a compiler that produced no diagnostic is not a program failure: {other:?}")
        }
    }

    // And the same for one killed by a signal, which is what an abort looks like from here.
    let killed = CompilerReport {
        ok: false,
        code: None,
        status: "was killed by signal 6".to_string(),
        stdout: String::new(),
        stderr: "Please submit a bug report".to_string(),
    };
    match classify(&killed) {
        Err(PrepareFailure::Toolchain(message)) => {
            assert!(message.contains("was killed by signal 6"), "{message}");
            assert!(message.contains("Please submit a bug report"), "{message}");
        }
        other => panic!("a crashed compiler is not a program failure: {other:?}"),
    }
}

#[test]
fn a_diagnostic_in_ggs_own_guest_is_ggs_failure_and_not_the_models() {
    // The model's file is named relatively and gg's inputs absolutely, which is what makes this
    // decidable at all. A model handed a diagnostic about a file it never wrote would be a model
    // asked to fix gg.
    let stderr = "/tmp/gg-toolchain-swift/guest/shell.swift:20:5: error: cannot find 'ggWat'\n";
    match classify(&report(false, stderr)) {
        Err(PrepareFailure::Toolchain(message)) => {
            assert!(
                message.contains("gg's own guest"),
                "the failure did not say whose it was: {message}"
            );
            assert!(message.contains("shell.swift"), "{message}");
        }
        other => panic!("a diagnostic in gg's own shell is not the model's failure: {other:?}"),
    }
}

#[test]
fn a_rejected_program_keeps_the_compilers_errors_and_drops_its_warnings() {
    // The errors and the source snippets the compiler draws under them are the half a model gains
    // most from, so they are kept whole. A warning is a style opinion about a program that is not
    // being reviewed.
    let stderr = "main.swift:2:5: warning: variable 'unused' was never used\n\
                  2 | let unused = 1\n\
                  main.swift:4:14: error: cannot find 'missing' in scope\n\
                  4 | let x = missing\n\
                  \x20 |         `- error: cannot find 'missing' in scope\n";
    match classify(&report(false, stderr)) {
        Err(PrepareFailure::Program(PrepareError::Compile(rendered))) => {
            assert!(
                rendered.contains("cannot find 'missing' in scope"),
                "{rendered}"
            );
            assert!(
                rendered.contains("`- error:"),
                "the compiler's own snippet was dropped: {rendered}"
            );
            assert!(
                !rendered.contains("never used"),
                "a warning reached the model: {rendered}"
            );
        }
        other => panic!("a rejected program is a compile failure, not {other:?}"),
    }
}

/// One `swiftc` error as the compiler prints it: the located header, the source line it drew under
/// it, and the caret under that. Three lines, which is why this arm is the most expensive of the
/// nine to leave unbounded.
fn swift_error(line: usize) -> String {
    format!(
        "main.swift:{line}:9: error: value of type 'Gg' has no member 'readAll'\n\
         {line} | let text = gg.readAll(path)\n\
         \x20 |            `- error: value of type 'Gg' has no member 'readAll'\n"
    )
}

#[test]
fn fifty_call_sites_of_one_mistake_reach_the_model_as_eight_and_a_count() {
    // The measurement this arm's bound exists for: one misremembered SDK name called at fifty call
    // sites is 11614 bytes across 395 lines here — the worst of the nine arms — because `swiftc`
    // draws an excerpt and a caret under every error. The model pays for all of it in this turn's
    // request and in every request after it, to be told one thing fifty times.
    let stderr: String = (1..=50).map(swift_error).collect();
    let Err(PrepareFailure::Program(PrepareError::Compile(rendered))) =
        classify(&report(false, &stderr))
    else {
        panic!("fifty diagnostics in the model's own file are the model's compile error");
    };
    assert_eq!(
        rendered.matches("has no member 'readAll'").count(),
        // Two per kept error: the header and the caret line repeat the message.
        SHOWN * 2,
        "at most {SHOWN} errors reach the model: {rendered}"
    );
    assert!(
        rendered.ends_with("\n… and 42 more like these."),
        "the count is not what was dropped: {rendered}"
    );
    // Each kept group arrives whole and unreflowed. An excerpt and a caret are a picture, and a
    // picture survives being cut but not being re-indented.
    assert!(
        rendered.starts_with(swift_error(1).trim_end()),
        "the first diagnostic is not the compiler's own three lines: {rendered}"
    );
}

#[test]
fn a_rejection_the_bound_does_not_reach_is_byte_for_byte_what_it_always_was() {
    // The ordinary turn — a couple of errors — must be untouched by the existence of a cap, down to
    // the whitespace `swiftc` chose. A bound that quietly reformats the common case would be paid on
    // every turn to save bytes on the rare one.
    let stderr = format!("{}{}", swift_error(4), swift_error(11));
    let Err(PrepareFailure::Program(PrepareError::Compile(rendered))) =
        classify(&report(false, &stderr))
    else {
        panic!("two diagnostics in the model's own file are the model's compile error");
    };
    assert_eq!(rendered, stderr.trim_end());
}

#[test]
fn the_band_is_decided_before_anything_is_dropped_for_length() {
    // The invariant a bound must not be able to break: whose failure it is comes off the WHOLE of
    // `swiftc`'s output. Here gg's own guest is named once, past the point any cap reaches, and the
    // compilation is still gg's failure rather than the model's — a model asked to fix a file it
    // never wrote is the one misattribution this arm spends the most effort not making.
    let mut stderr: String = (1..=40).map(swift_error).collect();
    stderr.push_str("/tmp/gg-toolchain-swift/guest/shell.swift:20:5: error: cannot find 'ggWat'\n");
    match classify(&report(false, &stderr)) {
        Err(PrepareFailure::Toolchain(message)) => assert!(
            message.contains("gg's own guest"),
            "the failure did not say whose it was: {message}"
        ),
        other => panic!("a diagnostic in gg's own shell is not the model's failure: {other:?}"),
    }
}

#[test]
fn a_compile_that_said_nothing_at_all_is_a_success() {
    assert!(classify(&report(true, "")).is_ok());
}

#[test]
fn the_toolchain_is_looked_for_where_the_installer_and_the_image_put_it() {
    // The three places, in order, and they must agree with `gg_swift_home` in
    // packages/gg-sandbox-swift/swift-version.sh — an installer that wrote somewhere gg does not
    // look is a toolchain nobody can find.
    let home = swift_home().expect("resolving the Swift home never fails");
    let resolved = home.to_string_lossy();
    assert!(
        resolved.starts_with(IMAGE_HOME) || resolved.ends_with(USER_HOME_SUFFIX),
        "gg resolved its Swift toolchain to {resolved}, which is neither the image's path nor the \
         installer's"
    );
}

#[test]
fn the_adapter_is_a_wasm_module_and_the_archive_is_a_gzip_stream() {
    // The two committed binaries, checked for what they are rather than only for being non-empty:
    // a truncated download that still had bytes in it would otherwise surface as an encode failure
    // on a model's first turn.
    assert_eq!(
        &ADAPTER[..8],
        b"\0asm\x01\0\0\0",
        "checkers/swift.adapter.wasm is not a wasm module"
    );
    assert_eq!(
        &GUEST_TAR_GZ[..2],
        b"\x1f\x8b",
        "checkers/swift.guest.tar.gz is not a gzip stream"
    );
}
