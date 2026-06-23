//! The run record: the central data contract produced by every run.
//!
//! See `docs/run-records.md`. This type tree is the **source of truth** for the
//! contract: the TypeScript bindings (`packages/run-record/src/index.ts`) and the
//! JSON Schema (`apps/docs/public/schema/core/run-record.schema.json`) are
//! generated from these types (which derive `ts_rs::TS` + `schemars::JsonSchema`
//! behind the `contract` feature) by `crates/contract-codegen` — never edited by
//! hand. Regenerate with `npm run gen:contract` after any change here. JSON is
//! camelCase.

use serde::{Deserialize, Serialize};

use crate::metrics::RunMetrics;
use crate::validation::ValidationSummary;

/// A stable slug identifying a supported agent harness.
///
/// Serializes to the snake/kebab-case slugs used throughout run records and the
/// site (all eight happen to be single-word lowercase tokens).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
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
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct RunSubject {
    /// The test case slug.
    pub test_case_slug: String,
    /// The exact, immutable test case version.
    pub test_case_version: String,
    /// The test type this case belongs to. Defaults to
    /// [`TestType::EndToEnd`](crate::TestType) so records written before the
    /// discriminator existed (all end-to-end) still deserialize. The UI branches
    /// on this to choose how to present a run's result.
    #[serde(default)]
    pub test_type: crate::test_case::TestType,
    /// The variant of the test case that was run (for example `base`).
    pub variant: String,
    /// The agent harness slug.
    pub harness_slug: HarnessSlug,
    /// The harness version, where it could be determined.
    pub harness_version: Option<String>,
    /// The resolved slug of the orchestrator that conducted the harness sessions
    /// (for example `one-shot` or `ralph`). For an external `--orchestrator-dir`
    /// this is the directory's own manifest slug, not the request's. Defaults to
    /// `one-shot` so records written before orchestrator selection existed — and
    /// hand-written fixtures — still deserialize. See
    /// [orchestrators](crate::OrchestratorCatalog).
    #[serde(default = "default_orchestrator_slug")]
    pub orchestrator_slug: String,
    /// The model ID passed to the harness, treated as an opaque string.
    pub model_id: String,
}

/// The default orchestrator slug for records that predate orchestrator selection:
/// every such run was a single, one-shot harness session.
fn default_orchestrator_slug() -> String {
    crate::orchestrator::ONE_SHOT_SLUG.to_string()
}

/// Provenance for the Test Cabinet build that orchestrated a run.
///
/// Distinct from [`RunSubject::harness_version`], which describes the agent
/// harness: this identifies the build of the Test Cabinet orchestrator itself,
/// so a run can be traced back to the exact code that produced it.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct RunTooling {
    /// The Test Cabinet commit the run's binary was built from, suffixed with
    /// `-dirty` when built from a modified working tree. `None` when the build
    /// could not determine it (for example, a build with no git repository).
    pub test_cabinet_commit: Option<String>,
}

impl RunTooling {
    /// The tooling provenance for the current build, stamped at compile time by
    /// `build.rs` into the `TEST_CABINET_COMMIT` environment variable.
    pub fn current() -> Self {
        Self {
            test_cabinet_commit: option_env!("TEST_CABINET_COMMIT").map(str::to_string),
        }
    }
}

/// The container environment a run executed in.
///
/// These values are captured from inside the run container — not the host — so
/// they describe the environment the harness actually built in. The harness
/// version is not duplicated here; it lives in [`RunSubject::harness_version`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct RunEnvironment {
    /// The container OS, taken from `/etc/os-release`'s `PRETTY_NAME` (for
    /// example, `Debian GNU/Linux 12 (bookworm)`). `unknown` when the probe
    /// could not determine it.
    pub os: String,
    /// The run-container image the run executed in: the single shared base image,
    /// the same for every harness. The full, pullable reference pulled by digest
    /// from the registry (for example,
    /// `ghcr.io/theclockwyrks/test-cabinet-base@sha256:…`), or the local-build
    /// fallback tag for an offline run.
    pub container_image: String,
    /// The Node.js version reported by `node --version` inside the container
    /// (for example, `v22.11.0`), or `None` when it could not be determined.
    pub node_version: Option<String>,
    /// Which authentication mode the run used. This is how the run's cost should
    /// be read: an API-key run is billed against that key, while a subscription
    /// run carries no per-run provider charge (a harness that still reports an
    /// exact charge — Claude Code does even on a subscription — is recorded
    /// as-is; one that reports none falls back to OpenRouter comparable pricing).
    pub auth_mode: AuthMode,
}

/// The authentication mode a run used, recorded so a published run is
/// self-describing about how its cost should be interpreted.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum AuthMode {
    /// A provider API key, injected into the run container as an environment
    /// variable. Billing is charged directly against that key.
    ApiKey,
    /// A harness account subscription, supplied as credential files copied into
    /// the run container. There is no per-run provider charge.
    Subscription,
}

/// Links to a run's published outputs.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct RunLinks {
    /// The public repository holding the run's generated source, when released.
    pub source_repo: Option<String>,
    /// The playable build, when one has been published.
    pub playable_build: Option<String>,
}

/// The terminal state of a run — the single axis that decides publishability and
/// how a run scores. Classified objectively at the point a run ends: a clean
/// harness exit splits into [`Completed`](RunState::Completed) vs
/// [`Catastrophic`](RunState::Catastrophic) on whether the output could be
/// evaluated; a run stopped before the harness finished is
/// [`TimedOut`](RunState::TimedOut) (the runtime cap) or
/// [`Infrastructure`](RunState::Infrastructure) (everything else).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum RunState {
    /// The harness exited cleanly and the run produced a usable, evaluable
    /// implementation. Published through the review gate and scored on the
    /// reviewer checklist.
    Completed,
    /// The harness exited cleanly — the model claimed completion — but the produced
    /// output did not build/load and could not be evaluated. The *model* is the
    /// reason: a catastrophic failure is real signal at the benchmark's edge, so it
    /// is publishable (carrying its broken source), but it has no review checklist
    /// to score and is reported as a separate catastrophic-failure statistic.
    Catastrophic,
    /// The run hit its maximum runtime and was stopped before the harness finished
    /// — the model never converged (a small model can legitimately loop on a hard
    /// task). A distinct, publishable tier from [`Catastrophic`](RunState::Catastrophic);
    /// likewise unscored and reported as its own timeout statistic.
    TimedOut,
    /// The Test Cabinet's own infrastructure failed: the harness binary errored or
    /// exited non-zero, the container would not start or pull, a pod was OOM-killed,
    /// or seeding / the case's init step failed. Not the model's fault — retained
    /// with a diagnostic [`RunStatus::detail`] for debugging, but **never**
    /// publishable and excluded from every model statistic.
    Infrastructure,
}

impl RunState {
    /// Whether a run in this state may be published at all. Every state except
    /// [`Infrastructure`](RunState::Infrastructure) is publishable — completed runs
    /// through the review gate, the failure tiers through the separate
    /// publish-failures path.
    pub fn is_publishable(self) -> bool {
        !matches!(self, RunState::Infrastructure)
    }

    /// Whether this state is one of the publishable *failure* tiers
    /// ([`Catastrophic`](RunState::Catastrophic) or [`TimedOut`](RunState::TimedOut)):
    /// publishable without a review and excluded from the reviewer checklist score.
    pub fn is_publishable_failure(self) -> bool {
        matches!(self, RunState::Catastrophic | RunState::TimedOut)
    }

    /// Classify a run that failed *before* producing an implementation. Only a
    /// harness session stopped at the run's maximum runtime is a model outcome (the
    /// model never converged) → [`TimedOut`](RunState::TimedOut); every other error
    /// — including the harness's own non-zero exit, the harness-install or case-init
    /// timeouts, and container/cluster faults — is the Test Cabinet's
    /// [`Infrastructure`](RunState::Infrastructure).
    pub fn classify_failure(err: &crate::Error) -> RunState {
        match err {
            crate::Error::RunTimedOut { .. } => RunState::TimedOut,
            _ => RunState::Infrastructure,
        }
    }
}

/// A run's status, with enough detail to understand a failure.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct RunStatus {
    /// The run's terminal state.
    pub state: RunState,
    /// Optional human-readable detail, required in practice for failures.
    pub detail: Option<String>,
}

/// The complete run record emitted by every run.
///
/// This is the contract consumed by the site and published with each run. Its
/// shape is deliberately fixed; the `packages/run-record` bindings and the
/// published JSON Schema are generated from it (see the module docs).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct RunRecord {
    /// A unique run ID.
    pub id: String,
    /// RFC 3339 timestamp for when the run started.
    pub started_at: String,
    /// RFC 3339 timestamp for when the run finished.
    pub finished_at: String,
    /// What was run.
    pub subject: RunSubject,
    /// Provenance for the Test Cabinet build that orchestrated the run.
    pub tooling: RunTooling,
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
