//! The ingest API's client-side contract: the lines of the streamed progress feed
//! `POST /ingest` answers with, the scan modes, what a finished scan came to, and the
//! request body a scan is asked for with.
//!
//! The HTTP client and the feed reader (`IngestFeed`, which reports a failed scan as
//! core's error) are runtime and live in `test_cabinet_core::backend_client`, which
//! re-exports everything here. The backend's server-side shapes of the same request
//! and stream are its own, in `crates/backend/src/api/ingest_api.rs`.

use serde::Deserialize;

/// One line of the ingest endpoint's streamed (`Accept: application/x-ndjson`)
/// progress feed.
///
/// The feed opens with a [`Start`](IngestProgress::Start), reports one
/// [`Version`](IngestProgress::Version) per version as it completes, and closes
/// with a single [`Done`](IngestProgress::Done) or [`Error`](IngestProgress::Error)
/// — the scan has already answered 200 by then, so a late failure arrives in band
/// rather than as a status code.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "event", rename_all = "camelCase")]
pub enum IngestProgress {
    /// The scan is starting, over `total` versions.
    Start {
        /// How many versions the scan will touch.
        total: usize,
    },
    /// One version finished, either (re)ingested or skipped as unchanged.
    #[serde(rename_all = "camelCase")]
    Version {
        /// 1-based position of this version within the scan.
        index: usize,
        /// How many versions the scan will touch.
        total: usize,
        /// The version's test case identity.
        slug: String,
        /// The version.
        version: String,
        /// Whether it was written, as against skipped because the store already
        /// held it unchanged.
        ingested: bool,
        /// How many reference images were rendered for it.
        #[serde(default)]
        rendered_references: usize,
        /// Why a skipped version was skipped, when the scan names one: a
        /// [`changed`](IngestMode::Changed) scan reports `unchanged` for a version
        /// whose stored content matches the checkout. Kept as the string the
        /// backend sent so a reason this build does not know still reads.
        #[serde(default)]
        reason: Option<String>,
        /// Why the version could not be ingested at all, naming the file and the
        /// failure: a suite version that does not validate, or a definition that
        /// cannot be lowered. Present only on a version reported with
        /// `ingested: false` for that reason.
        #[serde(default)]
        problem: Option<String>,
    },
    /// The scan finished.
    Done {
        /// How many versions it touched.
        total: usize,
        /// How many it (re)ingested.
        ingested: usize,
        /// How many it skipped as unchanged.
        skipped: usize,
    },
    /// The scan aborted, with the reason.
    Error {
        /// What went wrong.
        message: String,
    },
}

/// Which stored versions an ingest scan rewrites, short of `force` rewriting every
/// target.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum IngestMode {
    /// Ingest a target the store holds no record for, and skip every one it
    /// already holds whatever its content.
    #[default]
    Absent,
    /// Ingest a target the store holds no record for, or whose stored content
    /// digest or catalog version differs from the checkout's, and skip every other
    /// target as `unchanged`. This brings the store in line with the checkout
    /// without the client keeping any change-detection state.
    Changed,
}

/// What a completed ingest scan came to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IngestSummary {
    /// How many versions the scan touched.
    pub total: usize,
    /// How many it (re)ingested.
    pub ingested: usize,
    /// How many it skipped because the store already held them unchanged.
    pub skipped: usize,
}

/// The `POST /ingest` body a scan of `targets` is asked for with: every target
/// overwritten when `force` is set, and otherwise the stored targets `mode` names.
pub fn ingest_body(targets: &[String], force: bool, mode: IngestMode) -> serde_json::Value {
    let mut body = serde_json::json!({ "force": force });
    if !targets.is_empty() {
        body["testCases"] = serde_json::json!(targets);
    }
    if mode == IngestMode::Changed {
        body["mode"] = serde_json::json!("changed");
    }
    body
}

/// Parse one line of the ingest feed, ignoring a blank line and one whose shape
/// this build does not know — a newer backend may stream an event this client was
/// not written against, and that is not a reason to abandon a running scan.
pub fn parse_ingest_line(line: &str) -> Option<IngestProgress> {
    if line.is_empty() {
        return None;
    }
    serde_json::from_str(line).ok()
}
