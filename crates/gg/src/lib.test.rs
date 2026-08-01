//! Tests for the crate's outermost surface: the identity this binary ships under.
//!
//! `gg`'s version is not decoration. `core` reads it out of the run container
//! (`gg --version`) and records it as a run's
//! [`harness_version`](test_cabinet_core::run_record::RunSubject::harness_version) —
//! the only field that says which harness build produced a result — and, in a cluster
//! run, `core` also *asks GitHub for* a release named by its own version. Those two
//! crates are versioned independently, nothing at the type level ties them together,
//! and every way they can disagree fails silently. So the coupling is asserted here,
//! from the side that knows what the binary really is.

use test_cabinet_core::gg_exec::{DEFAULT_RELEASE_VERSION, release_asset_url};

/// The version this binary reports — what lands in a run record — and what `core`
/// will fetch from GitHub must be the same string.
///
/// Drift is invisible until a cluster run: `core` would request an asset tag that was
/// never cut (the run dies at gg's install step), or one that was cut for a *different*
/// build than the corpus is about to attribute its results to. Bumping one crate's
/// `version` and not the other's is exactly the mistake this catches, at compile-and-test
/// time rather than in production.
#[test]
fn the_default_release_version_matches_this_binary() {
    assert_eq!(env!("CARGO_PKG_VERSION"), DEFAULT_RELEASE_VERSION);
}

/// The version must be a real one. `0.0.0` — the workspace default every member crate
/// inherited before gg had a release pipeline — makes `harness_version` a constant
/// across the entire recorded corpus and names a release tag that will never exist.
#[test]
fn this_binary_reports_a_real_version() {
    assert_ne!(env!("CARGO_PKG_VERSION"), "0.0.0");
}

/// The URL `core` resolves for a default cluster install names *this* build, at the
/// tag `.github/workflows/release.yml` cuts (`v{version}`), with the asset name that
/// workflow's gg job uploads (`gg-{target}`).
///
/// The release legs cannot be exercised here, so this is the standing check that the
/// download side still agrees with the publish side: if the workflow's asset naming or
/// tag scheme changes, this string is what has to change with it.
#[test]
fn the_resolved_download_url_names_this_binarys_release_asset() {
    assert_eq!(
        release_asset_url(
            "TheClockwyrks/test-cabinet",
            DEFAULT_RELEASE_VERSION,
            "x86_64-unknown-linux-musl"
        ),
        format!(
            "https://github.com/TheClockwyrks/test-cabinet/releases/download/v{}/gg-x86_64-unknown-linux-musl",
            env!("CARGO_PKG_VERSION")
        )
    );
}

/// gg's own code holds **no unordered map or set**.
///
/// `HashMap`/`HashSet` iterate in an order `RandomState` reseeds every process, so any one of them
/// that is ever walked — rather than only looked up in — is a per-process non-determinism source
/// inside a harness whose whole product is a *comparable* recorded run. The failure is not
/// theoretical: the orchestrator walks its issue-wait registry to decide which blocked agents to
/// wake, so the wake order of a multi-agent run was a coin flip. And it is exactly the kind of
/// defect that a [playback](crate::replay_inputs) surfaces as a spurious turn-fingerprint
/// mismatch, because run-global state is rendered into every agent's pinned prompt each turn.
///
/// Auditing "is *this* one order-visible?" at each of a dozen sites is how the next one gets
/// missed, so the rule is the blunt one: gg's non-test code keys its maps and sets on `Ord` and
/// gets a stable order for free. Every collection here is small (a run's agents, issues, profiles,
/// enabled tools), so the ordered containers cost nothing measurable.
///
/// Tests are exempt: a test-local aggregation that is compared as a whole cannot leak an order into
/// a run.
#[test]
fn no_unordered_map_or_set_survives_in_ggs_own_code() {
    fn walk(dir: &std::path::Path, offenders: &mut Vec<String>) {
        for entry in std::fs::read_dir(dir).expect("gg's source tree is readable") {
            let path = entry.expect("a source entry").path();
            if path.is_dir() {
                walk(&path, offenders);
                continue;
            }
            let name = path.file_name().unwrap_or_default().to_string_lossy();
            // `foo.test.rs` — this crate's sibling-file test convention.
            if !name.ends_with(".rs") || name.ends_with(".test.rs") {
                continue;
            }
            let source = std::fs::read_to_string(&path).expect("a readable source file");
            for (number, line) in source.lines().enumerate() {
                // `hash_map::DefaultHasher` is a hasher, not a collection: `message_log` uses it to
                // fingerprint a message body, which is a pure function of that body.
                if line.contains("HashMap<")
                    || line.contains("HashSet<")
                    || line.contains("HashMap::")
                    || line.contains("HashSet::")
                {
                    offenders.push(format!("{}:{}: {}", name, number + 1, line.trim()));
                }
            }
        }
    }

    let mut offenders = Vec::new();
    walk(
        &std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src"),
        &mut offenders,
    );
    assert!(
        offenders.is_empty(),
        "gg's non-test code must key its maps and sets on `Ord` so iteration order is stable — \
         use `BTreeMap`/`BTreeSet`:\n{}",
        offenders.join("\n"),
    );
}
