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

    /// Whether this harness reaches its model **through OpenRouter** (it
    /// authenticates with `OPENROUTER_API_KEY`), as opposed to a provider-native
    /// endpoint. True for Cline, Goose, Kilo, OpenCode, and Pi; false for Codex
    /// (OpenAI), Claude (Anthropic), and Antigravity (Google). This governs
    /// whether a trailing `:free`-style OpenRouter variant tag is stripped when
    /// canonicalizing the model id (see [`crate::model_id`]). A drift test keeps
    /// this in step with each harness's `api_key_env`.
    pub fn routes_through_openrouter(self) -> bool {
        matches!(
            self,
            HarnessSlug::Cline
                | HarnessSlug::Goose
                | HarnessSlug::Kilo
                | HarnessSlug::Opencode
                | HarnessSlug::Pi
        )
    }

    /// Whether this harness reaches its model **through a provider route** whose
    /// prefix is prepended to the model id at launch — true only for OpenCode and
    /// Kilo Code, which pass the id verbatim to a CLI that routes through OpenRouter
    /// and so must launch with the `openrouter/` prefix (see
    /// [`crate::model_id::launch_model_id`]). The other OpenRouter-authenticated
    /// harnesses (Cline, Goose, Pi) pass a provider flag internally and launch the
    /// id unprefixed, so they are **not** included here — contrast the broader
    /// [`Self::routes_through_openrouter`]. Mirrors the run form's
    /// `PROVIDER_HARNESSES` set in `packages/ui/src/app/data/providers.ts`.
    pub fn uses_provider(self) -> bool {
        matches!(self, HarnessSlug::Opencode | HarnessSlug::Kilo)
    }

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

    /// The [`HarnessFamily`] this harness belongs to — the model-slug namespace it
    /// draws from. The three provider-native harnesses (Claude Code, Codex,
    /// Antigravity) are each their own family; every OpenRouter-routed harness
    /// shares the single [`HarnessFamily::Openrouter`] family, because a slug added
    /// for one of them (an OpenRouter id) is usable with all of them. A drift test
    /// keeps the OpenRouter arm in step with [`Self::routes_through_openrouter`].
    pub fn family(self) -> HarnessFamily {
        match self {
            HarnessSlug::Claude => HarnessFamily::Claude,
            HarnessSlug::Codex => HarnessFamily::Codex,
            HarnessSlug::Antigravity => HarnessFamily::Antigravity,
            HarnessSlug::Cline
            | HarnessSlug::Goose
            | HarnessSlug::Kilo
            | HarnessSlug::Opencode
            | HarnessSlug::Pi => HarnessFamily::Openrouter,
        }
    }
}

/// A family of harnesses that share a model-slug namespace — the set of model ids
/// usable with them.
///
/// A slug is only meaningful to the harnesses that speak its namespace: a Claude
/// Code slug (`claude-opus-4-8`) means nothing to Codex, and an OpenRouter slug
/// (`anthropic/claude-opus-4.8`) only resolves through the OpenRouter-routed
/// harnesses. So a curated model's slugs are each tagged with the family they
/// belong to (see the model catalog's aliases), which lets a run form offer only
/// the slugs the selected harness can actually launch. Every [`HarnessSlug`] maps
/// to exactly one family via [`HarnessSlug::family`]; the OpenRouter-routed
/// harnesses collapse into one family because they all take OpenRouter ids.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum HarnessFamily {
    /// Anthropic Claude Code — provider-native Anthropic model ids.
    Claude,
    /// OpenAI Codex — provider-native OpenAI model ids.
    Codex,
    /// Google Antigravity — provider-native Google model ids.
    Antigravity,
    /// Every OpenRouter-routed harness (Cline, Goose, Kilo, OpenCode, Pi): its
    /// slugs are OpenRouter ids (`provider/model`).
    Openrouter,
}

impl HarnessFamily {
    /// All families, in catalog order.
    pub const ALL: [HarnessFamily; 4] = [
        HarnessFamily::Claude,
        HarnessFamily::Codex,
        HarnessFamily::Antigravity,
        HarnessFamily::Openrouter,
    ];

    /// The wire slug for this family, matching the serde representation.
    pub fn as_str(self) -> &'static str {
        match self {
            HarnessFamily::Claude => "claude",
            HarnessFamily::Codex => "codex",
            HarnessFamily::Antigravity => "antigravity",
            HarnessFamily::Openrouter => "openrouter",
        }
    }

    /// Parse a wire slug back into a family, or `None` for an unrecognized value.
    pub fn from_wire(slug: &str) -> Option<HarnessFamily> {
        HarnessFamily::ALL.into_iter().find(|f| f.as_str() == slug)
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
            test_cabinet_commit: crate::COMMIT.map(str::to_string),
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
/// harness exit splits into [`Completed`](RunState::Completed) and
/// [`Catastrophic`](RunState::Catastrophic) (nothing to evaluate — the output
/// never built or loaded);
/// a harness that exits **non-zero** is a
/// [`HarnessError`](RunState::HarnessError) and one that stops responding
/// altogether is [`Hung`](RunState::Hung); a run stopped before the harness
/// finished is [`TimedOut`](RunState::TimedOut) (the runtime cap) or
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
    /// output did not build/load, so there is nothing to evaluate and **no playable
    /// build**. The *model* is the reason: a catastrophic failure is real signal at
    /// the benchmark's edge, so it is publishable (carrying its broken source), but
    /// it has no review checklist to score and is reported as a separate
    /// catastrophic-failure statistic.
    ///
    /// Reserved for a total failure to produce a runnable artifact. An output that
    /// builds and loads is reviewable however badly it behaves: a missing or
    /// non-conformant debug API fails the individual checklist points its validation
    /// scripts back (see
    /// [`DebugScriptResult`](crate::validation::DebugScriptResult)), scoring the run
    /// down rather than removing it from review.
    Catastrophic,
    /// The run hit its maximum runtime and was stopped before the harness finished
    /// — the model never converged (a small model can legitimately loop on a hard
    /// task). A distinct, publishable tier from [`Catastrophic`](RunState::Catastrophic);
    /// likewise unscored and reported as its own timeout statistic.
    TimedOut,
    /// The agent harness (or the orchestrator runner driving it) exited **non-zero**
    /// — the model drove the harness to exit early, a real and reportable signal
    /// about that model. Publishable **without** a review (recorded only as a
    /// per-model harness-error statistic on the model page), but — unlike the other
    /// failure tiers — it releases **no** source repo and no playable build: a
    /// harness-error run produced no evaluable output worth releasing.
    ///
    /// Publishing is never automatic: a subscription auth-token refresh also
    /// surfaces here as a non-zero exit and must **not** be reported, so a human
    /// decides per run (through the same publish-failures affordance the other
    /// tiers use) which harness errors to record.
    HarnessError,
    /// The agent harness stopped producing output entirely and was killed as hung
    /// — it neither finished nor failed, it stalled (a provider request that never
    /// returns, a subagent that never reports back).
    ///
    /// Treated exactly like a [`HarnessError`](RunState::HarnessError): publishable
    /// **without** a review as a per-model statistic, releasing no source repo and
    /// no playable build, and never published automatically. It is a distinct state
    /// because the cause is distinct — nothing exited, so there is no exit code to
    /// report — and because a hung run is the one failure the Test Cabinet ends on
    /// its own timer rather than observing.
    Hung,
    /// The Test Cabinet's own infrastructure failed: the container would not start
    /// or pull, a pod was OOM-killed, or seeding / the case's init step failed. Not
    /// the model's fault — retained with a diagnostic [`RunStatus::detail`] for
    /// debugging, but **never** publishable and excluded from every model statistic.
    /// A harness that merely exited non-zero is a
    /// [`HarnessError`](RunState::HarnessError), not this.
    Infrastructure,
}

impl RunState {
    /// Every terminal state, so callers that must enumerate them (the backend's
    /// wire-string lists, exhaustiveness tests) cannot silently miss a new one.
    pub const ALL: [RunState; 6] = [
        RunState::Completed,
        RunState::Catastrophic,
        RunState::TimedOut,
        RunState::HarnessError,
        RunState::Hung,
        RunState::Infrastructure,
    ];

    /// Whether a run in this state may be published at all. Every state except
    /// [`Infrastructure`](RunState::Infrastructure) is publishable — completed runs
    /// through the review gate, the failure tiers through the separate
    /// publish-failures path.
    pub fn is_publishable(self) -> bool {
        !matches!(self, RunState::Infrastructure)
    }

    /// Whether this state is one of the publishable *failure* tiers
    /// ([`Catastrophic`](RunState::Catastrophic),
    /// [`TimedOut`](RunState::TimedOut), or
    /// [`HarnessError`](RunState::HarnessError)): publishable without a review and
    /// excluded from the reviewer checklist score.
    pub fn is_publishable_failure(self) -> bool {
        matches!(
            self,
            RunState::Catastrophic | RunState::TimedOut | RunState::HarnessError | RunState::Hung
        )
    }

    /// Whether publishing a run in this state **releases** its produced artifacts —
    /// a public source repository and (when it built) a playable build. True for the
    /// code-carrying states ([`Completed`](RunState::Completed),
    /// [`Catastrophic`](RunState::Catastrophic),
    /// [`TimedOut`](RunState::TimedOut)); false for a
    /// [`HarnessError`](RunState::HarnessError), which is recorded only as
    /// a per-model statistic and releases nothing, and for the never-published
    /// [`Infrastructure`](RunState::Infrastructure). Note this is about the *release*
    /// step, not whether an asset-generation run has code to release — that gate is
    /// [`TestType::releases_source_repo`](crate::TestType::releases_source_repo).
    ///
    /// Releasing artifacts is not the same as *having* a playable build: only
    /// [`has_playable_build`](RunState::has_playable_build) answers that.
    pub fn publishes_artifacts(self) -> bool {
        matches!(
            self,
            RunState::Completed | RunState::Catastrophic | RunState::TimedOut
        )
    }

    /// Whether a run in this state produced a build that can actually be hosted and
    /// played. True only for [`Completed`](RunState::Completed): a run that built and
    /// loaded is completed however badly it validated, since a failing check now
    /// scores its checklist point down rather than diverting the run out of review.
    ///
    /// False for [`Catastrophic`](RunState::Catastrophic) (the build never loaded)
    /// and [`TimedOut`](RunState::TimedOut) (the harness never finished), which may
    /// still release their source without a build to go with it, and for the states
    /// that release nothing at all.
    pub fn has_playable_build(self) -> bool {
        matches!(self, RunState::Completed)
    }

    /// Classify a run that failed *before* producing an implementation. A harness
    /// session stopped at the run's maximum runtime is a model outcome (the model
    /// never converged) → [`TimedOut`](RunState::TimedOut); the harness (or its
    /// orchestrator runner) exiting non-zero is a
    /// [`HarnessError`](RunState::HarnessError) — the model drove it to exit early;
    /// a harness that went silent and was killed by the idle watchdog is
    /// [`Hung`](RunState::Hung); every other error — the harness-install or
    /// case-init timeouts and container/cluster faults — is the Test Cabinet's
    /// [`Infrastructure`](RunState::Infrastructure).
    pub fn classify_failure(err: &crate::Error) -> RunState {
        match err {
            crate::Error::RunTimedOut { .. } => RunState::TimedOut,
            crate::Error::HarnessInvocation { .. } => RunState::HarnessError,
            crate::Error::HarnessHung { .. } => RunState::Hung,
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
    /// The gameplay `README.md` a **game-jam** run produced, captured verbatim from
    /// the produced tree at run finish (trimmed to a sane cap). `None` for every
    /// other test type, and for a game-jam run that shipped no README.
    ///
    /// This is what makes a later jam run aware of what earlier runs already built:
    /// the backend serves the prior runs' READMEs (matched on the same jam, harness,
    /// and model) back to a new run, which seeds them and is asked to build something
    /// distinct. Kept out of a run's other surfaces — it exists to brief the *next*
    /// run, not to be displayed. Defaulted and omitted when absent so records written
    /// before the field existed still deserialize and non-jam records stay slim.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub game_jam_readme: Option<String>,
}

/// One earlier game-jam run's gameplay README, as served back to a new run of the
/// same jam with the same harness and model so the new run can build something
/// distinct from what came before.
///
/// This is not part of the published [`RunRecord`] contract — it is the internal
/// DTO the backend returns from `GET /game-jams/{slug}/prior-readmes` and the driver
/// threads into seeding and the prompt. The `readme` is the prior run's captured
/// [`RunRecord::game_jam_readme`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PriorGameJamEntry {
    /// The prior run's id, carried so an entry can be traced back to its run.
    pub run_id: String,
    /// RFC 3339 timestamp of when the prior run finished, used to order and label
    /// the entries (oldest first) when they are seeded.
    pub finished_at: String,
    /// The gameplay README the prior run produced.
    pub readme: String,
}

#[cfg(test)]
#[path = "run_record.test.rs"]
mod tests;
