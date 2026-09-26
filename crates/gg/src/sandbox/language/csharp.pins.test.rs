//! **The one C# version that is written down twice**, held to itself across a build.
//!
//! # What this file used to be, and why almost all of it is gone
//!
//! It was `csharp.manifest.test.rs`, and its subject was `checkers/csharp.toolchain.json` — a
//! declaration `packages/gg-sandbox-csharp/build.sh` wrote beside the 35 MB guest component it
//! produced, recording the component's byte count, the SHA-256 of each of the three C sources the
//! guest is compiled from, and every pin the build read. Three tests recomputed those from the
//! checkout, so that a `Sources/*.c` edited without a rebuild, or a version bumped in
//! `csharp-version.sh` without one, failed here by name instead of leaving every C# program in a run
//! interpreted by last month's runtime.
//!
//! It was the right gate for a committed artifact and it is not needed for a generated one. The
//! guest is not committed: `gg-artifact-csharp` relinks it into a cargo `OUT_DIR` on every build
//! whose declared inputs moved — and `packages/gg-sandbox-csharp/Sources` and `csharp-version.sh`
//! are both in that rerun set — so the component `crates/gg` embeds was linked from the C in this
//! checkout, at the pins in this checkout, by the same `cargo build`. A test comparing the two would
//! be comparing one input against itself.
//!
//! **The measurement that settles it, because "just commit it and check" was the alternative:** two
//! builds of the identical checkout, differing only in the directory the toolchains were unpacked
//! into, produced components of 35 263 680 and 35 263 728 bytes. The link bakes its own absolute
//! paths in. So the committed component could never have been verified by rebuilding it and
//! comparing — the manifest could attest what the build was *told*, never what it *produced* — and a
//! declaration whose only reader was that manifest went with it.
//!
//! # What survives, and why it is a different question
//!
//! One assertion, and it never read the manifest. **Two files in two languages name the C# language
//! version**: the shell script that builds the guest, and the Rust that passes `-langversion` to
//! `csc` on the turn path. Nothing generates either from the other and nothing else compares them,
//! so this is a genuine cross-language invariant rather than a claim about a build's freshness — and
//! it is the one that the manifest structurally could not make, because the manifest agreed with the
//! script it was written by.

use super::compile::LANGUAGE_VERSION;

/// The pins in **this checkout**, read as text for the same reason the Kotlin arm's test reads its
/// own: a shell script is not a data format gg can parse, and the value that matters is unambiguous
/// to look for.
const VERSIONS: &str = include_str!("../../../../../packages/gg-sandbox-csharp/csharp-version.sh");

/// The C++ arm's pins, which this arm's file **sources** rather than restating: the wasi-sdk release
/// and the `wit-bindgen` release are shared between the two, deliberately, so that two arms reading
/// one `crates/gg/wit` cannot describe the wire differently. Searched second, so a value this arm
/// pinned for itself always wins.
const SHARED_VERSIONS: &str = include_str!("../../../../../packages/gg-sandbox-cpp/cpp-version.sh");

/// The value `key` is assigned in `csharp-version.sh`, without the quotes.
fn pinned(key: &str) -> String {
    let prefix = format!("{key}=\"");
    let find = |text: &'static str| {
        text.lines()
            .find_map(|line| line.trim().strip_prefix(&prefix)?.strip_suffix('"'))
    };
    find(VERSIONS)
        .or_else(|| find(SHARED_VERSIONS))
        .unwrap_or_else(|| {
            panic!("{key} is not pinned in csharp-version.sh or the file it sources")
        })
        .to_string()
}

#[test]
fn the_language_version_the_compiler_pins_is_the_one_the_guest_was_built_at() {
    // Two files name the C# language version — the shell script that builds the guest and the Rust
    // that passes it to `csc` — and they are on opposite sides of a build. A program compiled as
    // C# 14 against a guest whose BCL came from a different band is exactly the shape of drift no
    // rerun set can catch, because the two are not inputs to one another: re-running the build with
    // a bumped `GG_DOTNET_LANG_VERSION` produces a perfectly consistent guest and leaves the host
    // still asking `csc` for the old band.
    assert_eq!(
        LANGUAGE_VERSION,
        pinned("GG_DOTNET_LANG_VERSION"),
        "csharp.compile.rs and csharp-version.sh disagree about which C# a model may write"
    );
}
