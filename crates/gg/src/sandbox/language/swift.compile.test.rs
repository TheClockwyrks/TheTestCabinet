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
fn the_archive_holds_exactly_what_its_manifest_declares() {
    // The manifest is what an operator reads and what the shared-directory key is derived beside;
    // an archive that lost a file would otherwise fail as a `swiftc` error about a missing input,
    // three layers down from the thing that was actually wrong.
    //
    // Both sides come out of one run of `build.sh` — the file list is its reading of the staging
    // tree and the archive is `tar`'s — so what this asks is whether gg's own unpacking put back
    // everything that was packed, at the size it was packed at. That is a live question however the
    // archive got here, which is why it outlived the drift checks that used to sit beside it.
    let guest = guest().expect("the Swift guest this build cut unpacks");
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
            "{name} in the archive is not the size its manifest declares"
        );
    }
}

#[test]
fn the_archive_is_placed_read_only() {
    // The seam's rule for a shared toolchain directory, asserted rather than assumed: `swiftc`
    // reads these files and must never be able to write beside them, because a shared tree a
    // compilation writes into is the measured `purs` corruption exactly.
    let guest = guest().expect("the Swift guest this build cut unpacks");
    let path = guest.file("shell.o");
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

// WHAT USED TO BE HERE: `the_shell_gg_compiles_beside_every_program_is_the_one_this_checkout_
// committed`, which unpacked the guest archive and compared its `shell.swift` and `gg-shell.h`
// against `packages/gg-sandbox-swift/Sources` byte for byte. The archive was COMMITTED, so somebody
// could edit the shell and not re-cut it, and those two files were the only part of this arm's guest
// that anything could read back out — the SDK is `gg.o` and `gg.swiftmodule`, and no comparison
// reaches inside either.
//
// Both sides are now cut by the same `cargo build`: `crates/gg-sandbox-artifacts/swift` runs
// `build.sh` whenever anything under `Sources/` moves, and `build.sh` copies those exact two files
// into the staging tree immediately before packing it. The assertion could not fail, and a test that
// cannot fail reads like cover for the part of the surface that never was covered.
//
// Nothing was gained by keeping it and nothing was lost by removing it, because the hole it sat
// beside is the one that closed: an edit to `Sources/SDK/**` used to match nothing anything could
// compare, and it now re-cuts `gg.swiftmodule` before the host that embeds it finishes compiling.

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
fn a_diagnostic_in_a_code_module_is_the_models_wherever_the_compiler_located_it() {
    // A program's own compile reads its code modules as built modules rather than as source, so a
    // location the compiler recovers from one's recorded source information carries the absolute
    // path that module was compiled under. It is still a file the model can act on — by not calling
    // that skill's code — where every other absolute path in a `swiftc` run here is gg's own.
    let stderr = "/gg/work/module_notes.swift:2:5: error: cannot find 'views' in scope\n";
    match classify(&report(false, stderr)) {
        Err(PrepareFailure::Program(PrepareError::Compile(rendered))) => {
            assert!(rendered.contains("module_notes.swift:2:5"), "{rendered}");
        }
        other => panic!("a diagnostic in a code module is the model's: {other:?}"),
    }
}

#[test]
fn a_binding_key_that_names_a_module_every_compile_supplies_is_refused() {
    // A code module is compiled under its own key, so a key that is already a module name would put
    // two modules of one name in a single link. The refusal names the collision; the alternative is
    // a duplicate-symbol failure from the linker that names nobody.
    for key in [
        super::super::SURFACE_MODULE,
        PROGRAM_MODULE,
        SHELL_MODULE,
        "Foundation",
    ] {
        match refuse_a_supplied_name(key) {
            Err(PrepareFailure::Program(PrepareError::Unsupported(message))) => {
                assert!(
                    message.contains(key),
                    "the refusal did not name it: {message}"
                );
            }
            other => {
                panic!("`{key}` is a module every program here is compiled against: {other:?}")
            }
        }
    }
    assert!(refuse_a_supplied_name("csvTools").is_ok());
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
    // The two embedded binaries, checked for what they are rather than only for being non-empty:
    // a truncated download that still had bytes in it would otherwise surface as an encode failure
    // on a model's first turn. The adapter is the one this arm does not build — `build.sh` copies it
    // out of a version-stamped cache that a `curl` fills on a cold machine — so it is the one where
    // "bytes, but not the right kind of bytes" is a thing that can actually happen.
    assert_eq!(
        &ADAPTER[..8],
        b"\0asm\x01\0\0\0",
        "swift.adapter.wasm is not a wasm module"
    );
    assert_eq!(
        &GUEST_TAR_GZ[..2],
        b"\x1f\x8b",
        "swift.guest.tar.gz is not a gzip stream"
    );
}

/// **An unresolved import is answered with the modules of this arm's set that match it.**
///
/// The one cell of the [cross-arm gate](crate::sandbox::language::imports) that needs `swiftc`: it
/// drives a program importing a near-miss of a module this arm really carries through this arm's
/// real preparation, and holds what comes back to the name the program wrote. What it catches is a
/// compiler that reworded its own sentence, which is silent otherwise — the arm recovers nothing,
/// every rejection falls back to the whole inventory, and nothing reports it.
#[test]
fn an_unresolved_import_is_answered_with_the_candidates_that_match_it() {
    crate::sandbox::language::imports::gate(test_cabinet_core::gg::GgProgramLanguage::Swift);
}

/// **A code module gg rebuilt beside a program is gg's own failure and never the model's.**
///
/// The one cell of the [cross-arm gate](crate::sandbox::language::rebuilds) that needs swiftc: it
/// hands this arm's program step a module this workspace holds no build of and that swiftc refuses,
/// and reads the band of what comes back. What it catches is a rebuild's diagnostic reaching a model
/// under `Compiler error`, over a program that compiles and a file the model never wrote.
#[test]
fn a_code_module_refused_beside_a_program_is_ggs_failure() {
    crate::sandbox::language::rebuilds::gate(test_cabinet_core::gg::GgProgramLanguage::Swift);
}
