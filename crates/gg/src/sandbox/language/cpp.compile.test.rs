//! What the C++ arm knows without running a compiler: what it carries, what it says it carries, and
//! how it reads a finished `clang++`.
//!
//! The compiler's own behaviour is [`substrate`](super::super::cpp::substrate)'s subject; nothing
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
    // The manifest is what an operator reads and what the shared-directory key is derived beside; an
    // archive that lost a file would otherwise fail as a `clang++` error about a missing input,
    // three layers down from the thing that was actually wrong.
    let guest = guest().expect("the committed C++ guest unpacks");
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
    // The seam's rule for a shared toolchain directory, asserted rather than assumed: `clang++`
    // reads these files and must never be able to write beside them, because a shared tree a
    // compilation writes into is the measured `purs` corruption exactly.
    let guest = guest().expect("the committed C++ guest unpacks");
    let path = guest.file("prelude.hpp");
    let metadata = std::fs::metadata(&path).expect("the prelude is in the unpacked guest");
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
fn what_gg_compiles_every_program_against_is_what_this_checkout_committed() {
    // The archive is built from `packages/gg-sandbox-cpp/Sources` and committed; a checkout that
    // edited the prelude or the shell without rebuilding would compile every program against the old
    // one, and nothing else would say so. Compared by content rather than by size so a same-length
    // edit is caught too.
    //
    // The shell is in the archive as SOURCE as well as as an object precisely for this: the object
    // is what links, and the source is the only thing a comparison like this can read. The SDK's
    // HEADERS are in it for a stronger reason than comparison — they are what the prelude
    // precompiles and what a program is declared against, so a stale copy is a model compiled
    // against a surface it was not shown.
    let guest = guest().expect("the committed C++ guest unpacks");
    let prelude = std::fs::read_to_string(guest.file("prelude.hpp")).expect("the prelude unpacks");
    assert_eq!(
        prelude,
        include_str!("../../../../../packages/gg-sandbox-cpp/Sources/prelude.hpp"),
        "crates/gg/src/sandbox/checkers/cpp.guest.tar.gz is stale — run \
         packages/gg-sandbox-cpp/build.sh and commit it"
    );
    let shell = std::fs::read_to_string(guest.file("shell.cpp")).expect("the shell unpacks");
    assert_eq!(
        shell,
        include_str!("../../../../../packages/gg-sandbox-cpp/Sources/shell.cpp"),
        "the committed shell object was built from a different source than this checkout's"
    );

    // Every SDK header, compared the same way — and the LIST compared too, so a header added to the
    // SDK and left out of a rebuild is caught rather than silently absent from the tree the prelude
    // is precompiled out of.
    let mut shipped: Vec<&str> = guest_files()
        .filter(|name| name.starts_with("sdk/"))
        .collect();
    shipped.sort_unstable();
    let mut written: Vec<&str> = SDK_HEADERS.iter().map(|(name, _)| *name).collect();
    written.sort_unstable();
    assert_eq!(
        shipped, written,
        "the committed archive's SDK headers and this checkout's are not the same set — run          packages/gg-sandbox-cpp/build.sh and commit it"
    );
    for (name, source) in SDK_HEADERS {
        let committed = std::fs::read_to_string(guest.file(name))
            .unwrap_or_else(|error| panic!("{name} unpacks: {error}"));
        assert_eq!(
            &committed, source,
            "the archive's copy of {name} is not this checkout's, so every program would be              compiled against a surface the catalogue does not describe"
        );
    }
}

/// This checkout's SDK headers, beside the names they ride in the archive under.
///
/// Written out rather than globbed, because a macro that walked the directory would go green on a
/// header nobody committed — and the point of the comparison is that the set is the same on both
/// sides.
const SDK_HEADERS: &[(&str, &str)] = &[
    (
        "sdk/api.hpp",
        include_str!("../../../../../packages/gg-sandbox-cpp/Sources/sdk/api.hpp"),
    ),
    (
        "sdk/error.hpp",
        include_str!("../../../../../packages/gg-sandbox-cpp/Sources/sdk/error.hpp"),
    ),
    (
        "sdk/gg.hpp",
        include_str!("../../../../../packages/gg-sandbox-cpp/Sources/sdk/gg.hpp"),
    ),
    (
        "sdk/options.hpp",
        include_str!("../../../../../packages/gg-sandbox-cpp/Sources/sdk/options.hpp"),
    ),
    (
        "sdk/types.hpp",
        include_str!("../../../../../packages/gg-sandbox-cpp/Sources/sdk/types.hpp"),
    ),
    (
        "sdk/wire.hpp",
        include_str!("../../../../../packages/gg-sandbox-cpp/Sources/sdk/wire.hpp"),
    ),
    (
        "sdk/objects/agents.hpp",
        include_str!("../../../../../packages/gg-sandbox-cpp/Sources/sdk/objects/agents.hpp"),
    ),
    (
        "sdk/objects/context.hpp",
        include_str!("../../../../../packages/gg-sandbox-cpp/Sources/sdk/objects/context.hpp"),
    ),
    (
        "sdk/objects/fs.hpp",
        include_str!("../../../../../packages/gg-sandbox-cpp/Sources/sdk/objects/fs.hpp"),
    ),
    (
        "sdk/objects/harness.hpp",
        include_str!("../../../../../packages/gg-sandbox-cpp/Sources/sdk/objects/harness.hpp"),
    ),
    (
        "sdk/objects/memory.hpp",
        include_str!("../../../../../packages/gg-sandbox-cpp/Sources/sdk/objects/memory.hpp"),
    ),
    (
        "sdk/objects/programs.hpp",
        include_str!("../../../../../packages/gg-sandbox-cpp/Sources/sdk/objects/programs.hpp"),
    ),
    (
        "sdk/objects/project.hpp",
        include_str!("../../../../../packages/gg-sandbox-cpp/Sources/sdk/objects/project.hpp"),
    ),
    (
        "sdk/objects/review.hpp",
        include_str!("../../../../../packages/gg-sandbox-cpp/Sources/sdk/objects/review.hpp"),
    ),
    (
        "sdk/objects/skills.hpp",
        include_str!("../../../../../packages/gg-sandbox-cpp/Sources/sdk/objects/skills.hpp"),
    ),
    (
        "sdk/objects/system.hpp",
        include_str!("../../../../../packages/gg-sandbox-cpp/Sources/sdk/objects/system.hpp"),
    ),
    (
        "sdk/objects/tasks.hpp",
        include_str!("../../../../../packages/gg-sandbox-cpp/Sources/sdk/objects/tasks.hpp"),
    ),
    (
        "sdk/objects/view.hpp",
        include_str!("../../../../../packages/gg-sandbox-cpp/Sources/sdk/objects/view.hpp"),
    ),
];

#[test]
fn every_header_the_manifest_claims_is_one_the_prelude_really_includes() {
    // The library set a model will be told it has, held to the file that actually ships it. The
    // manifest is generated from the prelude by `build.sh`, so this catches a manifest hand-edited
    // into claiming something — which is the one failure that would put a header in a prompt and not
    // in the compile.
    let prelude = include_str!("../../../../../packages/gg-sandbox-cpp/Sources/prelude.hpp");
    let included: Vec<&str> = prelude
        .lines()
        .filter_map(|line| line.strip_prefix("#include <"))
        .filter_map(|rest| rest.strip_suffix('>'))
        .collect();
    for header in prelude_headers() {
        assert!(
            included.contains(&header),
            "the manifest claims <{header}> and the prelude does not include it"
        );
    }
    assert_eq!(
        prelude_headers().count(),
        included.len(),
        "the prelude includes a header the manifest does not declare — re-run \
         packages/gg-sandbox-cpp/build.sh"
    );
}

#[test]
fn a_compiler_that_said_nothing_is_never_reported_as_the_models_failure() {
    // The band the study needs kept apart: a crash, a timeout and a precompiled header the compiler
    // could not read all exit non-zero, and reporting any of them as "your program did not compile"
    // sends a model rewriting a program that was never wrong.
    match classify(&report(false, "")) {
        Err(PrepareFailure::Toolchain(message)) => {
            assert!(
                message.contains(compiler_version()),
                "a toolchain failure did not name the compiler: {message}"
            );
        }
        other => {
            panic!("a compiler that produced no diagnostic is not a program failure: {other:?}")
        }
    }

    // And the same for one killed by a signal, which is what an internal compiler error looks like
    // from here.
    let killed = CompilerReport {
        ok: false,
        code: None,
        status: "was killed by signal 11".to_string(),
        stdout: String::new(),
        stderr: String::new(),
    };
    match classify(&killed) {
        Err(PrepareFailure::Toolchain(message)) => {
            assert!(message.contains("was killed by signal 11"), "{message}");
        }
        other => panic!("a crashed compiler is not a program failure: {other:?}"),
    }
}

#[test]
fn a_template_error_reported_inside_libcpp_is_still_the_models_program() {
    // The C++-shaped half of classification, and the one an arm that copied Swift's rule would have
    // got wrong. The `error:` here is located in libc++'s own `<format>`; what makes it the model's
    // is the `note:` under it, which is the line the model actually wrote. Reading only the error's
    // path would file the most ordinary C++ mistake there is under "gg's toolchain broke".
    let stderr = "/opt/gg/toolchains/wasi-sdk/share/wasi-sysroot/include/c++/v1/__format/\
                  format_functions.h:170:19: error: static assertion failed\n\
                  \x20 170 |   static_assert(__formattable, \"the type must be formattable\");\n\
                  main.cpp:7:19: note: in instantiation of function template specialization \
                  'std::format<Widget>' requested here\n";
    match classify(&report(false, stderr)) {
        Err(PrepareFailure::Program(PrepareError::Compile(rendered))) => {
            assert!(rendered.contains("static assertion failed"), "{rendered}");
            assert!(
                rendered.contains("main.cpp:7:19: note:"),
                "the note naming the model's own line was dropped: {rendered}"
            );
        }
        other => panic!("a template error is the model's program, not {other:?}"),
    }
}

#[test]
fn an_undefined_symbol_is_the_models_program_even_though_the_linker_names_no_file() {
    // A model that declares something and never defines it. The linker reports no location at all,
    // so the general rule — "was the model's file named?" — would file this under gg's toolchain and
    // spend an operator's turn on a mistake the model could fix in one line.
    let stderr = "wasm-ld: error: /tmp/main-1f2e3d.o: undefined symbol: helper()\n\
                  clang++: error: linker command failed with exit code 1 (use -v to see \
                  invocation)\n";
    match classify(&report(false, stderr)) {
        Err(PrepareFailure::Program(PrepareError::Compile(rendered))) => {
            assert!(
                rendered.contains("undefined symbol: helper()"),
                "{rendered}"
            );
            assert!(
                !rendered.contains("linker command failed"),
                "the driver's summary about its own process reached the model: {rendered}"
            );
        }
        other => panic!("an undefined symbol is the model's program, not {other:?}"),
    }
}

#[test]
fn a_diagnostic_in_ggs_own_guest_is_ggs_failure_and_not_the_models() {
    // The model's file is named relatively and gg's inputs absolutely, and gg's own inputs are the
    // only files besides the model's that a compile reads. A model handed a diagnostic about a file
    // it never wrote would be a model asked to fix gg.
    let stderr = "/tmp/gg-toolchain-cpp/guest/sdk/objects/fs.hpp:57:1: error: unknown type name \
                  'file_read'\n";
    match classify(&report(false, stderr)) {
        Err(PrepareFailure::Toolchain(message)) => {
            assert!(
                message.contains("gg's own guest"),
                "the failure did not say whose it was: {message}"
            );
            assert!(message.contains("fs.hpp"), "{message}");
        }
        other => panic!("a diagnostic in gg's own prelude is not the model's failure: {other:?}"),
    }
}

#[test]
fn a_rejected_program_keeps_the_compilers_errors_and_drops_its_warnings() {
    // The errors, the source snippets clang draws under them and the notes attached to them are the
    // half a model gains most from, so they are kept whole. A warning is a style opinion about a
    // program that is not being reviewed.
    let stderr = "main.cpp:3:7: warning: unused variable 'spare' [-Wunused-variable]\n\
                  \x20   3 |   int spare = 1;\n\
                  \x20     |       ^~~~~\n\
                  main.cpp:5:11: error: use of undeclared identifier 'missing'\n\
                  \x20   5 |   auto x = missing;\n\
                  \x20     |           ^\n";
    match classify(&report(false, stderr)) {
        Err(PrepareFailure::Program(PrepareError::Compile(rendered))) => {
            assert!(
                rendered.contains("use of undeclared identifier 'missing'"),
                "{rendered}"
            );
            assert!(
                rendered.contains("auto x = missing;"),
                "the compiler's own snippet was dropped: {rendered}"
            );
            assert!(
                !rendered.contains("unused variable"),
                "a warning reached the model: {rendered}"
            );
        }
        other => panic!("a rejected program is a compile failure, not {other:?}"),
    }
}

#[test]
fn a_compile_that_said_nothing_at_all_is_a_success() {
    assert!(classify(&report(true, "")).is_ok());
}

#[test]
fn the_toolchain_is_looked_for_where_the_installer_and_the_image_put_it() {
    // The three places, in order, and they must agree with `gg_wasi_sdk_home` in
    // packages/gg-sandbox-cpp/cpp-version.sh — an installer that wrote somewhere gg does not look is
    // a toolchain nobody can find.
    let home = wasi_sdk_home().expect("resolving the wasi-sdk home never fails");
    let resolved = home.to_string_lossy();
    assert!(
        resolved.starts_with(IMAGE_HOME) || resolved.ends_with(USER_HOME_SUFFIX),
        "gg resolved its wasi-sdk to {resolved}, which is neither the image's path nor the \
         installer's"
    );
}

#[test]
fn the_precompiled_headers_key_moves_when_the_compiler_is_reinstalled() {
    // A PCH may only be read by the clang that wrote it AND records the identity of every header it
    // precompiled, so a wasi-sdk reinstalled at the same version invalidates one without changing
    // any version anybody wrote down. The stamp is what makes the shared directory's name move with
    // it; without it, a reinstall would leave a stale PCH that every compile then failed to load.
    let home = wasi_sdk_home().expect("resolving the wasi-sdk home never fails");
    let stamp = compiler_stamp(&home);
    assert_ne!(
        stamp,
        "absent",
        "no compiler at {} to stamp — run scripts/ci/install-wasi-sdk.sh",
        home.display()
    );
    assert_eq!(
        stamp,
        compiler_stamp(&home),
        "the stamp is not a function of the compiler alone"
    );
    assert_eq!(
        compiler_stamp(Path::new("/nonexistent/gg-wasi-sdk")),
        "absent",
        "a missing compiler must stamp to something rather than panicking"
    );
}

#[test]
fn the_flags_that_have_to_agree_are_the_ones_the_committed_objects_were_built_with() {
    // Spelled twice — here and in `packages/gg-sandbox-cpp/build.sh` — because the prebuilt objects
    // and the per-turn compile have to agree about both: an object compiled without the exception
    // flags does not link against libc++'s `eh` build, and one compiled under a different hardening
    // mode is a mixture nobody should have to think about. This is the cheap half of holding them
    // together; the dear half is
    // `a_cpp_program_throws_and_catches_which_no_other_compiled_arm_can_do`, which compiles one and
    // runs it.
    let build = include_str!("../../../../../packages/gg-sandbox-cpp/build.sh");
    for flag in EXCEPTION_FLAGS
        .iter()
        .chain(std::iter::once(&HARDENING_FLAG))
    {
        assert!(
            build.contains(flag),
            "packages/gg-sandbox-cpp/build.sh does not pass {flag}, which every per-turn compile \
             does"
        );
    }
}

#[test]
fn the_adapter_is_a_wasm_module_and_the_archive_is_a_gzip_stream() {
    // The two committed binaries, checked for what they are rather than only for being non-empty: a
    // truncated download that still had bytes in it would otherwise surface as an encode failure on
    // a model's first turn.
    assert_eq!(
        &ADAPTER[..8],
        b"\0asm\x01\0\0\0",
        "checkers/cpp.adapter.wasm is not a wasm module"
    );
    assert_eq!(
        &GUEST_TAR_GZ[..2],
        b"\x1f\x8b",
        "checkers/cpp.guest.tar.gz is not a gzip stream"
    );
}
