//! The run record: the central data contract produced by every run.
//!
//! See `docs/run-records.md`. This type tree is mirrored exactly in TypeScript
//! in `packages/run-record`. JSON is camelCase.

use serde::{Deserialize, Serialize};

use crate::metrics::RunMetrics;
use crate::validation::ValidationSummary;

/// A stable slug identifying a supported agent harness.
///
/// Serializes to the snake/kebab-case slugs used throughout run records and the
/// site (all eight happen to be single-word lowercase tokens).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HarnessSlug {
    /// Anthropic Claude Code (`claude`).
    Claude,
    /// OpenAI Codex (`codex`).
    Codex,
    /// Cline (`cline`).
    Cline,
    /// Google Antigravity (`antigravity`).
    Antigravity,
    /// Goose (`goose`).
    Goose,
    /// Kilo Code (`kilo`).
    Kilo,
    /// OpenCode (`opencode`).
    Opencode,
    /// Pi (`pi`).
    Pi,
}

impl HarnessSlug {
    /// All supported harness slugs, in catalog order.
    pub const ALL: [HarnessSlug; 8] = [
        HarnessSlug::Claude,
        HarnessSlug::Codex,
        HarnessSlug::Cline,
        HarnessSlug::Antigravity,
        HarnessSlug::Goose,
        HarnessSlug::Kilo,
        HarnessSlug::Opencode,
        HarnessSlug::Pi,
    ];

    /// The wire slug for this harness, matching the serde representation.
    pub fn as_str(&self) -> &'static str {
        match self {
            HarnessSlug::Claude => "claude",
            HarnessSlug::Codex => "codex",
            HarnessSlug::Cline => "cline",
            HarnessSlug::Antigravity => "antigravity",
            HarnessSlug::Goose => "goose",
            HarnessSlug::Kilo => "kilo",
            HarnessSlug::Opencode => "opencode",
            HarnessSlug::Pi => "pi",
        }
    }
}

/// The subject of a run: what was run, with what, against which model.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunSubject {
    /// The test case slug.
    pub test_case_slug: String,
    /// The exact, immutable test case version.
    pub test_case_version: String,
    /// The variant of the test case that was run (for example `base`).
    pub variant: String,
    /// The agent harness slug.
    pub harness_slug: HarnessSlug,
    /// The harness version, where it could be determined.
    pub harness_version: Option<String>,
    /// The model ID passed to the harness, treated as an opaque string.
    pub model_id: String,
}

/// The container environment a run executed in.
///
/// These values are captured from inside the run container — not the host — so
/// they describe the environment the harness actually built in. The harness
/// version is not duplicated here; it lives in [`RunSubject::harness_version`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunEnvironment {
    /// The container OS, taken from `/etc/os-release`'s `PRETTY_NAME` (for
    /// example, `Debian GNU/Linux 12 (bookworm)`). `unknown` when the probe
    /// could not determine it.
    pub os: String,
    /// The per-harness container image the run executed in (for example,
    /// `test-cabinet/codex:latest`).
    pub container_image: String,
    /// The Node.js version reported by `node --version` inside the container
    /// (for example, `v22.11.0`), or `None` when it could not be determined.
    pub node_version: Option<String>,
}

/// Links to a run's published outputs.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunLinks {
    /// The public repository holding the run's generated source, when released.
    pub source_repo: Option<String>,
    /// The playable build, when one has been published.
    pub playable_build: Option<String>,
}

/// The terminal state of a run.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunState {
    /// The run completed and produced an implementation.
    Completed,
    /// The run failed before producing a usable implementation.
    Failed,
    /// The run produced output that could not be evaluated.
    Unevaluable,
}

/// A run's status, with enough detail to understand a failure.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunStatus {
    /// Whether the run completed, failed, or could not be evaluated.
    pub state: RunState,
    /// Optional human-readable detail, required in practice for failures.
    pub detail: Option<String>,
}

/// The complete run record emitted by every run.
///
/// This is the contract consumed by the site and published with each run. Its
/// shape is deliberately fixed and mirrored in `packages/run-record`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunRecord {
    /// A unique run ID.
    pub id: String,
    /// RFC 3339 timestamp for when the run started.
    pub started_at: String,
    /// RFC 3339 timestamp for when the run finished.
    pub finished_at: String,
    /// What was run.
    pub subject: RunSubject,
    /// The container environment the run executed in.
    pub environment: RunEnvironment,
    /// Resource metrics for the run.
    pub metrics: RunMetrics,
    /// Summary of the validation pass.
    pub validation: ValidationSummary,
    /// Links to published outputs.
    pub links: RunLinks,
    /// Terminal status.
    pub status: RunStatus,
}

#[cfg(test)]
#[path = "run_record.test.rs"]
mod tests;
