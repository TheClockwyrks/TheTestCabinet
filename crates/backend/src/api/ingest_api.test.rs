//! Unit tests for the ingest handler's snapshot-refresh trigger decision.

use super::scan_changed_store;
use crate::ingest::{IngestReport, IngestedVersion};

fn version(slug: &str, ingested: bool) -> IngestedVersion {
    IngestedVersion {
        slug: slug.to_string(),
        version: "v1.0.0".to_string(),
        ingested,
        rendered_references: 0,
    }
}

fn report(versions: Vec<IngestedVersion>) -> IngestReport {
    IngestReport {
        test_case_versions: versions,
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
