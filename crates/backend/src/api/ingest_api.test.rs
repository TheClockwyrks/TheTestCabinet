//! Unit tests for the ingest handler's snapshot-refresh trigger decision.

use super::{
    done_line, ingest_response, progress_line, promote_for_store_readiness, scan_changed_store,
};
use crate::ingest::{
    IngestEvent, IngestReport, IngestRequest, IngestedSuite, IngestedVersion, SkipReason,
};
use test_cabinet_core::IngestMode;
use test_cabinet_core::backend_client::{IngestBody, IngestBodyMode};

fn version(slug: &str, ingested: bool) -> IngestedVersion {
    IngestedVersion {
        slug: slug.to_string(),
        version: "v1.0.0".to_string(),
        ingested,
        rendered_references: 0,
        reason: None,
        problem: None,
    }
}

fn report(versions: Vec<IngestedVersion>) -> IngestReport {
    IngestReport {
        test_case_versions: versions,
        suite_versions: Vec::new(),
        test_case_groups_changed: false,
        refused_prunes: Vec::new(),
    }
}

// An empty scan (nothing to ingest) has not changed the store, so no refresh is
// queued — a checkout with no cases must not fire a gallery rebuild.
#[test]
fn empty_scan_does_not_change_store() {
    assert!(!scan_changed_store(&report(vec![])));
}

// A no-op scan where every version was already present and unchanged leaves the
// store as it was, so the periodic non-forced ingest does not rebuild the gallery.
#[test]
fn all_versions_unchanged_does_not_change_store() {
    let r = report(vec![version("fathom", false), version("carom", false)]);
    assert!(!scan_changed_store(&r));
}

// A scan that (re)ingested at least one version changed the definition store the
// snapshot's case metadata is exported from, so a refresh is queued. This is the
// path that republishes a corrected snapshot after an emptied store is repopulated
// (the ephemeral `/state` self-heal, or a manual re-ingest).
#[test]
fn any_ingested_version_changes_store() {
    let r = report(vec![version("fathom", false), version("carom", true)]);
    assert!(scan_changed_store(&r));
}

// A scan that changed only the test-case-group set still refreshes: the snapshot
// exports the set as its own object, so a group edit with every version unchanged
// must republish.
#[test]
fn a_changed_group_set_changes_store() {
    let r = IngestReport {
        test_case_versions: vec![version("fathom", false)],
        suite_versions: Vec::new(),
        test_case_groups_changed: true,
        refused_prunes: Vec::new(),
    };
    assert!(scan_changed_store(&r));
}

// While `/healthz` reports `storeReady: false` no stored record is servable, so a
// `changed` scan ingests every target.
#[test]
fn a_changed_scan_against_an_unready_store_is_forced() {
    let changed = IngestRequest {
        mode: IngestMode::Changed,
        ..Default::default()
    };
    assert!(promote_for_store_readiness(changed.clone(), false).force);
    assert!(!promote_for_store_readiness(changed, true).force);
}

// A default scan keeps its meaning whatever the store's readiness: the stale-format
// promotion inside the scan is what repairs an unreadable store.
#[test]
fn a_default_scan_is_not_forced_by_readiness() {
    assert!(!promote_for_store_readiness(IngestRequest::default(), false).force);
}

#[test]
fn the_body_accepts_changed_and_nothing_else_for_mode() {
    let body: IngestBody = serde_json::from_str(r#"{"mode":"changed"}"#).expect("changed parses");
    assert_eq!(body.mode, Some(IngestBodyMode::Changed));
    let body: IngestBody = serde_json::from_str("{}").expect("an empty body parses");
    assert_eq!(body.mode, None);
    assert!(serde_json::from_str::<IngestBody>(r#"{"mode":"sometimes"}"#).is_err());
}

// A skipped version's line names why it was skipped; an ingested one carries no
// reason at all.
#[test]
fn a_version_line_names_its_skip_reason() {
    let mut skipped = version("carom", false);
    skipped.reason = Some(SkipReason::Unchanged);
    let line = serde_json::to_value(progress_line(IngestEvent::Version {
        index: 1,
        total: 2,
        version: &skipped,
    }))
    .expect("serializes");
    assert_eq!(line["event"], "version");
    assert_eq!(line["ingested"], false);
    assert_eq!(line["reason"], "unchanged");

    let ingested = version("fathom", true);
    let line = serde_json::to_value(progress_line(IngestEvent::Version {
        index: 2,
        total: 2,
        version: &ingested,
    }))
    .expect("serializes");
    assert!(line.get("reason").is_none(), "{line}");
}

// A version that failed to resolve is a `version` line carrying `ingested: false`
// and the problem naming the file and the failure, so a client streaming the scan
// can say why a version is absent from the store.
#[test]
fn a_version_that_failed_to_resolve_streams_its_problem() {
    let failed = IngestedVersion {
        problem: Some(
            "test suite `carom@v1.0.0` is invalid: test-cases/efficiency.toml: TBD".to_string(),
        ),
        ..version("carom-efficiency", false)
    };
    let line = serde_json::to_value(progress_line(IngestEvent::Version {
        index: 1,
        total: 1,
        version: &failed,
    }))
    .expect("the event serializes");
    assert_eq!(line["event"], "version");
    assert_eq!(line["ingested"], false);
    assert_eq!(
        line["problem"],
        "test suite `carom@v1.0.0` is invalid: test-cases/efficiency.toml: TBD"
    );

    // A version without one carries no `problem` key at all.
    let clean = serde_json::to_value(progress_line(IngestEvent::Version {
        index: 1,
        total: 1,
        version: &version("carom-ball", true),
    }))
    .expect("the event serializes");
    assert!(clean.get("problem").is_none(), "{clean}");
}

// The closing summary counts a problem toward `skipped`, a refused suite version
// included, because each was one `version` line of the feed.
#[test]
fn a_problem_counts_toward_skipped() {
    let report = IngestReport {
        test_case_versions: vec![
            version("carom-ball", true),
            IngestedVersion {
                problem: Some("broken".to_string()),
                ..version("carom-efficiency", false)
            },
        ],
        suite_versions: vec![IngestedSuite {
            slug: "pinball".to_string(),
            version: "v1.0.0".to_string(),
            ingested: false,
            reason: None,
            problem: Some("broken".to_string()),
        }],
        test_case_groups_changed: false,
        refused_prunes: Vec::new(),
    };
    let done = serde_json::to_value(done_line(&report)).expect("the event serializes");
    assert_eq!(done["total"], 3);
    assert_eq!(done["ingested"], 1);
    assert_eq!(done["skipped"], 2);
    assert!(done.get("refusedPrunes").is_none(), "{done}");
}

// A refused prune reaches both framings: the closing feed line and the default
// report carry the sentences the scan reported, so neither a streaming client nor
// a blocking one ingests past a refusal without being told.
#[test]
fn a_refused_prune_reaches_the_feed_and_the_report() {
    let refusal = "kept 3 stored authored test-case version(s): `x` declares no version";
    let report = IngestReport {
        refused_prunes: vec![refusal.to_string()],
        ..report(vec![])
    };
    let done = serde_json::to_value(done_line(&report)).expect("the event serializes");
    assert_eq!(done["refusedPrunes"], serde_json::json!([refusal]));
    let response = serde_json::to_value(ingest_response(report)).expect("the report serializes");
    assert_eq!(response["refusedPrunes"], serde_json::json!([refusal]));
}
