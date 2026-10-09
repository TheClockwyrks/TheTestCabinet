//! The ingest API's contract: the `POST /ingest` request body, the report it answers
//! with by default, the lines of the streamed progress feed it answers with instead
//! when asked, the scan modes, and what a finished scan came to.
//!
//! The backend reads the body and writes the report and the feed with these types,
//! and the client writes the body and reads the feed with them, so the two sides of
//! the wire cannot drift. The HTTP client and the feed reader (`IngestFeed`, which
//! reports a failed scan as core's error) are runtime and live in
//! `test_cabinet_core::backend_client`, which re-exports everything here; the scan
//! itself is the backend's, in `crates/backend/src/ingest.rs`.

use serde::{Deserialize, Serialize};

/// One line of the ingest endpoint's streamed (`Accept: application/x-ndjson`)
/// progress feed.
///
/// The feed opens with a [`Start`](IngestProgress::Start), reports one
/// [`Version`](IngestProgress::Version) per version as it completes, and closes
/// with a single [`Done`](IngestProgress::Done) or [`Error`](IngestProgress::Error)
/// — the scan has already answered 200 by then, so a late failure arrives in band
/// rather than as a status code.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
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
        #[serde(default, skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
        /// Why the version could not be ingested at all, naming the file and the
        /// failure: a suite version that does not validate, or a definition that
        /// cannot be lowered. Present only on a version reported with
        /// `ingested: false` for that reason.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        problem: Option<String>,
    },
    /// The scan finished.
    #[serde(rename_all = "camelCase")]
    Done {
        /// How many versions it touched.
        total: usize,
        /// How many it (re)ingested.
        ingested: usize,
        /// How many it skipped as unchanged.
        skipped: usize,
        /// One sentence per prune the scan refused because a tree it read was
        /// empty, naming what it kept. Omitted when nothing was refused.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        refused_prunes: Vec<String>,
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

/// The `POST /ingest` request body. Every field may be omitted: an empty body is a
/// whole-catalog scan that skips every target the store already holds.
///
/// The fields are declared in key order, so a body serializes to the bytes the
/// client always sent.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestBody {
    /// A version token (the client's build commit) tagging a whole-catalog ingest,
    /// letting the backend skip the re-render when the catalog is unchanged.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub catalog_version: Option<String>,
    /// Rewrite every target whatever the store holds.
    #[serde(default)]
    pub force: bool,
    /// Which stored targets a scan that is not forced rewrites; omitted, it is the
    /// default scan, which skips every target the store already holds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<IngestBodyMode>,
    /// Restrict the scan to these entries. Each is a bare case `id` (slug or folder
    /// name, expanding to all its versions), a version-qualified `id@version` (that
    /// one version only), a suite slug (every definition of every version it
    /// declares) or a suite version as `<suite>@<version>`. Omitted or empty means a
    /// whole-catalog scan, which enumerates the authored catalog and the suites tree
    /// together.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub test_cases: Option<Vec<String>>,
}

/// The `mode` values the ingest body accepts. Omitting `mode` is the default scan,
/// [`IngestMode::Absent`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum IngestBodyMode {
    /// [`IngestMode::Changed`]: ingest only targets whose content differs from the
    /// store.
    Changed,
}

impl IngestBodyMode {
    /// The scan mode a body's `mode` asks for.
    pub fn scan_mode(mode: Option<Self>) -> IngestMode {
        match mode {
            Some(IngestBodyMode::Changed) => IngestMode::Changed,
            None => IngestMode::Absent,
        }
    }
}

/// The `POST /ingest` body a scan of `targets` is asked for with: every target
/// overwritten when `force` is set, and otherwise the stored targets `mode` names.
pub fn ingest_body(targets: &[String], force: bool, mode: IngestMode) -> IngestBody {
    IngestBody {
        catalog_version: None,
        force,
        mode: match mode {
            IngestMode::Absent => None,
            IngestMode::Changed => Some(IngestBodyMode::Changed),
        },
        test_cases: (!targets.is_empty()).then(|| targets.to_vec()),
    }
}

/// The report `POST /ingest` answers with when the client does not ask for the
/// streamed feed: every version and suite version the scan touched.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestResponse {
    /// The test case versions the scan touched, a suite-defined case among them
    /// under the identity it was ingested as.
    pub test_case_versions: Vec<IngestResponseVersion>,
    /// The suite versions the scan touched: each suite's own record, which is keyed
    /// beside its cases.
    pub test_suites: Vec<IngestResponseSuite>,
    /// One sentence per prune the scan refused because a tree it read was empty,
    /// naming what it kept. Omitted when nothing was refused.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub refused_prunes: Vec<String>,
}

/// One scanned test case version in the [`IngestResponse`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestResponseVersion {
    /// The version's test case identity.
    pub slug: String,
    /// The version.
    pub version: String,
    /// Whether it was written, as against skipped.
    pub ingested: bool,
    /// How many reference images were rendered for it.
    pub rendered_references: usize,
    /// Why a skipped version was skipped, when the scan names a reason.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// Why the version could not be ingested, naming the file and the failure.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub problem: Option<String>,
}

/// One scanned suite version in the [`IngestResponse`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestResponseSuite {
    /// The suite's slug.
    pub slug: String,
    /// The suite version.
    pub version: String,
    /// Whether it was written, as against skipped.
    pub ingested: bool,
    /// Why a skipped suite version was skipped, when the scan names a reason.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// Why the suite version was refused, naming the file and the failure.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub problem: Option<String>,
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

#[cfg(test)]
#[path = "ingest.test.rs"]
mod tests;
