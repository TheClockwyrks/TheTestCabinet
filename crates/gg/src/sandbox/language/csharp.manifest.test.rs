//! **The committed guest against what says it built it** — the gate that catches an artifact
//! nobody rebuilt.
//!
//! `packages/gg-sandbox-csharp/build.sh` writes `checkers/csharp.toolchain.json` beside the
//! component it produces, and `scripts/ci/contract-drift.sh` does **not** re-cut either: the build
//! needs a whole .NET SDK and a whole wasi-sdk, which is not a thing to download on every CI run to
//! confirm bytes that are already committed. So the artifact is a *declared* exemption there, and
//! this file is what the declaration rests on.
//!
//! Three comparisons, and each closes a way the artifact and the checkout can silently disagree:
//!
//! * **the manifest against the component**, so a manifest regenerated without the component (or the
//!   reverse) fails by name;
//! * **the manifest against the shell's source in this checkout**, so a `Sources/shell.c` edited
//!   without a rebuild fails here rather than leaving every C# program running last month's shell;
//! * **the manifest against the pins**, so a version bumped in `csharp-version.sh` without a rebuild
//!   fails rather than describing a guest built by something else.

use sha2::{Digest, Sha256};

use super::GUEST_COMPONENT;

/// What `packages/gg-sandbox-csharp/build.sh` wrote beside the guest it produced.
const MANIFEST: &str = include_str!("../checkers/csharp.toolchain.json");

/// The shell in **this checkout** — the source the committed component was supposed to be built
/// from.
const SHELL: &str = include_str!("../../../../../packages/gg-sandbox-csharp/Sources/shell.c");

/// The pins in **this checkout**, read as text for the same reason the Kotlin arm's test reads its
/// own: a shell script is not a data format gg can parse, and the two or three values that matter
/// are unambiguous to look for.
const VERSIONS: &str = include_str!("../../../../../packages/gg-sandbox-csharp/csharp-version.sh");

/// The C++ arm's pins, which this arm's file **sources** rather than restating: the wasi-sdk release
/// and the `wit-bindgen` release are shared between the two, deliberately, so that two arms reading
/// one `crates/gg/wit` cannot describe the wire differently. Searched second, so a value this arm
/// pinned for itself always wins.
const SHARED_VERSIONS: &str = include_str!("../../../../../packages/gg-sandbox-cpp/cpp-version.sh");

/// The manifest, parsed.
fn manifest() -> serde_json::Value {
    serde_json::from_str(MANIFEST).expect("csharp.toolchain.json is valid JSON")
}

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
fn the_manifest_describes_the_component_that_is_actually_committed() {
    let declared = manifest()["componentBytes"]
        .as_u64()
        .expect("the manifest declares the component's size");
    assert_eq!(
        declared as usize,
        GUEST_COMPONENT.len(),
        "guests/csharp.component.wasm and checkers/csharp.toolchain.json were not written by the \
         same run of packages/gg-sandbox-csharp/build.sh — re-run it and commit both"
    );
}

#[test]
fn the_committed_guest_was_built_from_this_checkouts_shell() {
    // The failure this exists for is silent and expensive: a shell edited without a rebuild leaves
    // every C# program in the run being evaluated by the shell that was committed, with the source
    // in front of a reader saying something else.
    let digest = Sha256::digest(SHELL.as_bytes());
    assert_eq!(
        manifest()["shellSha256"].as_str().unwrap_or_default(),
        format!("{digest:x}"),
        "packages/gg-sandbox-csharp/Sources/shell.c has changed since the committed guest was \
         built — re-run packages/gg-sandbox-csharp/build.sh and commit the component with it"
    );
}

#[test]
fn the_committed_guest_was_built_at_the_versions_this_checkout_pins() {
    let manifest = manifest();
    for (field, pin) in [
        ("dotnetSdk", "GG_DOTNET_SDK_VERSION"),
        ("dotnetRuntime", "GG_DOTNET_RUNTIME_VERSION"),
        ("targetFramework", "GG_DOTNET_TFM"),
        ("languageVersion", "GG_DOTNET_LANG_VERSION"),
        ("target", "GG_CSHARP_TARGET"),
        ("wasiSdk", "GG_WASI_SDK_VERSION"),
        ("witBindgen", "GG_WIT_BINDGEN_VERSION"),
    ] {
        assert_eq!(
            manifest[field].as_str().unwrap_or_default(),
            pinned(pin),
            "the committed guest's {field} is not what {pin} pins — re-run \
             packages/gg-sandbox-csharp/build.sh"
        );
    }
}

#[test]
fn the_language_version_the_compiler_pins_is_the_one_the_guest_was_built_at() {
    // Two files name the C# language version — the shell script that builds the guest and the Rust
    // that passes it to `csc` — and they are on opposite sides of a build. A program compiled as
    // C# 14 against a guest whose BCL came from a different band is exactly the shape of drift the
    // manifest above cannot see, because the manifest agrees with the script it was written by.
    assert_eq!(
        super::compile::LANGUAGE_VERSION,
        pinned("GG_DOTNET_LANG_VERSION"),
        "csharp.compile.rs and csharp-version.sh disagree about which C# a model may write"
    );
}
