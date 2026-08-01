//! Tests for `tcab gg-replay`'s two resolutions: which record is being reconstructed, and which
//! `gg` is reconstructing it.
//!
//! Both are pure functions with the filesystem injected, which is deliberate: the download leg
//! cannot be exercised here (it needs a published release and a network), so the *decision* to
//! download — and every decision that avoids one — is what has to be pinned instead.

use super::*;
use crate::cli::{Cli, Command};
use clap::Parser as _;

/// Parse a `tcab gg-replay` invocation into its arguments.
fn args(argv: &[&str]) -> GgReplayArgs {
    let mut full = vec!["tcab", "gg-replay"];
    full.extend_from_slice(argv);
    match Cli::try_parse_from(full)
        .expect("the invocation parses")
        .command
    {
        Command::GgReplay(args) => args,
        other => panic!("expected gg-replay, got {other:?}"),
    }
}

// ---------------------------------------------------------------------------
// Naming the record
// ---------------------------------------------------------------------------

/// The **kept** flag still names a local file. `--record` is shipped surface: demoting it to a
/// positional would break every script and shell history that already spells it this way.
#[test]
fn the_record_flag_still_names_a_local_file() {
    let source = RecordSource::from_args(&args(&["--record", "/tmp/replay.json"])).unwrap();
    assert_eq!(
        source,
        RecordSource::File(PathBuf::from("/tmp/replay.json")),
    );
}

/// The **added** positional names a published run, which is the common case — the run you want to
/// understand is one somebody linked you to.
#[test]
fn a_bare_run_id_names_a_published_run() {
    let source = RecordSource::from_args(&args(&["run-abc"])).unwrap();
    assert_eq!(source, RecordSource::Run("run-abc".to_string()));
}

/// Naming both is a parse error, not a precedence rule. Which of the two a silent winner-takes-all
/// picked would be invisible in the output, and the whole command exists to be trusted about what
/// it reconstructed.
#[test]
fn a_run_id_and_a_record_conflict() {
    let err = Cli::try_parse_from(["tcab", "gg-replay", "run-abc", "--record", "/tmp/r.json"])
        .expect_err("naming both sources is rejected");
    assert_eq!(
        err.kind(),
        clap::error::ErrorKind::ArgumentConflict,
        "{err}"
    );
}

/// Naming neither is a parse error too — the clap group is `required`, so the message is in terms
/// of the arguments the user did not type.
#[test]
fn naming_no_record_at_all_is_rejected() {
    let err =
        Cli::try_parse_from(["tcab", "gg-replay"]).expect_err("a record must be named somehow");
    assert_eq!(
        err.kind(),
        clap::error::ErrorKind::MissingRequiredArgument,
        "{err}"
    );
}

/// The source labels itself differently for the two forms, so the reconstruction's opening line
/// says what it actually read.
#[test]
fn each_source_labels_itself() {
    assert_eq!(
        RecordSource::File(PathBuf::from("/tmp/replay.json")).label(),
        "/tmp/replay.json",
    );
    assert_eq!(RecordSource::Run("run-abc".into()).label(), "run `run-abc`");
}

// ---------------------------------------------------------------------------
// Resolving `--gg`
// ---------------------------------------------------------------------------

/// The repo and triple used below — the same ones the run path installs gg by.
const REPO: &str = "TheClockwyrks/test-cabinet";
const TARGET: &str = "x86_64-unknown-linux-musl";

fn resolve(spec: &str, cache: &str, existing: &[&str]) -> anyhow::Result<ResolvedGg> {
    let existing: Vec<PathBuf> = existing.iter().map(PathBuf::from).collect();
    resolve_gg_with(spec, Path::new(cache), REPO, TARGET, |path| {
        existing.iter().any(|e| e == path)
    })
}

/// `--gg` is optional: omitting it reconstructs in this process, which is the overwhelmingly
/// common case and must not need a flag.
#[test]
fn the_gg_override_is_absent_by_default() {
    assert!(args(&["--record", "/tmp/replay.json"]).gg.is_none());
}

/// A spec naming an existing binary is that binary — how a locally-built gg is used.
#[test]
fn an_existing_path_resolves_to_that_binary() {
    let resolved = resolve(
        "/cargo-target/the-test-cabinet/release/gg",
        "/cache",
        &["/cargo-target/the-test-cabinet/release/gg"],
    )
    .unwrap();
    assert_eq!(
        resolved,
        ResolvedGg::OnDisk(PathBuf::from("/cargo-target/the-test-cabinet/release/gg")),
    );
}

/// A **path-shaped** spec that does not exist is an error, never a silent reinterpretation as a
/// version. Reinterpreting it would send a typo'd path to GitHub and report the resulting 404 as
/// though the version were the problem.
#[test]
fn a_missing_path_is_an_error_not_a_version() {
    let err = resolve("/opt/gg-0.6.9", "/cache", &[]).unwrap_err();
    assert!(
        err.to_string().contains("/opt/gg-0.6.9") && err.to_string().contains("does not exist"),
        "{err}",
    );
    // A relative path is path-shaped for the same reason, even without a separator after `.`.
    assert!(resolve("./gg", "/cache", &[]).is_err());
}

/// A bare version resolves to the release asset URL the run path installs gg from, cached under a
/// name that carries the target triple as well as the version.
#[test]
fn a_version_resolves_to_the_release_asset() {
    let resolved = resolve("0.6.9", "/cache", &[]).unwrap();
    assert_eq!(
        resolved,
        ResolvedGg::Download {
            version: "0.6.9".to_string(),
            url:
                "https://github.com/TheClockwyrks/test-cabinet/releases/download/v0.6.9/gg-x86_64-unknown-linux-musl"
                    .to_string(),
            path: PathBuf::from("/cache/gg-0.6.9-x86_64-unknown-linux-musl"),
        },
    );
}

/// The URL is the one `core` resolves for the same version, rather than a second copy of the
/// convention. Two independent spellings of the tag or the asset name is exactly the drift that
/// makes one of them fetch from a release that was never cut.
#[test]
fn the_download_url_is_the_one_the_run_path_installs_from() {
    let ResolvedGg::Download { url, .. } = resolve("0.6.9", "/cache", &[]).unwrap() else {
        panic!("an uncached version downloads");
    };
    assert_eq!(
        url,
        test_cabinet_core::gg_exec::release_asset_url(REPO, "0.6.9", TARGET),
    );
}

/// A leading `v` is accepted, because the release *tag* is `v0.6.9` and copying it out of a
/// releases page is the natural thing to do.
#[test]
fn a_leading_v_is_accepted() {
    let ResolvedGg::Download { version, url, .. } = resolve("v0.6.9", "/cache", &[]).unwrap()
    else {
        panic!("an uncached version downloads");
    };
    assert_eq!(version, "0.6.9");
    assert!(url.contains("/download/v0.6.9/"), "{url}");
}

/// A version already in the cache is used as-is — no second download, and no network at all.
#[test]
fn a_cached_version_is_reused() {
    let resolved = resolve(
        "0.6.9",
        "/cache",
        &["/cache/gg-0.6.9-x86_64-unknown-linux-musl"],
    )
    .unwrap();
    assert_eq!(
        resolved,
        ResolvedGg::OnDisk(PathBuf::from("/cache/gg-0.6.9-x86_64-unknown-linux-musl")),
    );
}

/// The cache key carries the target triple, so a cache directory that outlives a change of
/// `TCAB_GG_RELEASE_TARGET` does not hand back a binary for the wrong architecture — a failure
/// nothing downstream would explain.
#[test]
fn the_cache_key_is_per_target() {
    let ResolvedGg::Download { path, .. } = resolve_gg_with(
        "0.6.9",
        Path::new("/cache"),
        REPO,
        "aarch64-unknown-linux-musl",
        |path| path == Path::new("/cache/gg-0.6.9-x86_64-unknown-linux-musl"),
    )
    .unwrap() else {
        panic!("the x86_64 copy in the cache is not this target's");
    };
    assert_eq!(
        path,
        PathBuf::from("/cache/gg-0.6.9-aarch64-unknown-linux-musl"),
    );
}

/// A spec that is neither a version nor a path is refused with a message that says what the flag
/// takes, rather than forming a URL that 404s.
#[test]
fn a_spec_that_is_neither_a_version_nor_a_path_is_refused() {
    for spec in ["latest", "stable", "gg", ""] {
        let err = resolve(spec, "/cache", &[]).unwrap_err();
        assert!(
            err.to_string().contains("released gg version"),
            "`{spec}`: {err}",
        );
    }
}

/// A bare `v` is not a version either — it strips to nothing, and a URL with an empty version in it
/// is the kind of request that 404s in a way nobody can read.
#[test]
fn a_bare_v_is_not_a_version() {
    assert!(resolve("v", "/cache", &[]).is_err());
    assert!(resolve("vnext", "/cache", &[]).is_err());
}

/// The scratch path a download is written to appends its suffix rather than replacing an
/// "extension" — a cache name's last `.` is the one inside the version, so `with_extension` would
/// collapse `gg-0.6.9-x86_64-…` and `gg-0.6.4-aarch64-…` onto the same `gg-0.6.partial`, and two
/// concurrent downloads would overwrite each other's bytes before either was renamed into place.
#[test]
fn the_partial_download_path_appends_rather_than_replaces() {
    assert_eq!(
        partial_path(Path::new("/cache/gg-0.6.9-x86_64-unknown-linux-musl")),
        PathBuf::from("/cache/gg-0.6.9-x86_64-unknown-linux-musl.partial"),
    );
}
