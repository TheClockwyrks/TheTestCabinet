//! The run record: the central data contract produced by every run.
//!
//! See `docs/run-records.md`. This type tree is the **source of truth** for the
//! contract: the TypeScript bindings (`packages/run-record/src/index.ts`) and the
//! JSON Schema (`apps/docs/public/schema/core/run-record.schema.json`) are
//! generated from these types (which derive `ts_rs::TS` + `schemars::JsonSchema`
//! behind the `contract` feature) by `crates/contract-codegen` — never edited by
//! hand. Regenerate with `npm run gen:contract` after any change here. JSON is
//! camelCase.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::code_analysis::CodeAnalysisSummary;
use crate::gg::{GgCapabilitySet, GgSessionSummary};
use crate::metrics::RunMetrics;
use crate::test_case::MediaKind;
use crate::toolchain::ToolchainSummary;
use crate::validation::ValidationSummary;

/// A stable slug identifying an agent harness — a run's subject.
///
/// Serializes to the snake/kebab-case slugs used throughout run records and the
/// site (every slug happens to be a single-word lowercase token).
///
/// The first eight are the **third-party CLI harnesses** The Test Cabinet
/// integrates: each ships a `harnesses/<slug>/harness.toml` manifest, installs a
/// CLI into the run container, and is shelled out to. [`Gg`](HarnessSlug::Gg) is
/// different in kind — the Test Cabinet's own first-party executor, invoked
/// directly rather than through a manifest/CLI — so it is **deliberately not** a
/// member of [`ALL`](HarnessSlug::ALL) (the CLI-harness catalog) and is handled on
/// its own path everywhere ALL is enumerated. It is still a first-class run
/// subject: a gg run yields a scoreable [`RunRecord`] carrying `harness_slug: gg`.
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
    /// gg (`gg`) — The Test Cabinet's own first-party coding harness (backronym
    /// GameGen). Unlike the eight above it is not a third-party CLI: it is a
    /// standalone binary that runs *inside* the run container carrying the LLM
    /// client, agent turn loop, tool dispatch, and telemetry emitter, and core
    /// invokes it directly (no orchestrator, no `tcab-session` wrapper, no
    /// manifest). For Phase 0 it reaches its model **through OpenRouter**
    /// (`OPENROUTER_API_KEY`), so it belongs to [`HarnessFamily::Openrouter`].
    /// Because it is a distinct run mode rather than a ninth catalog entry, it is
    /// excluded from [`ALL`](HarnessSlug::ALL); use [`from_wire`](HarnessSlug::from_wire)
    /// when a wire slug must resolve to any variant, gg included.
    Gg,
}

impl HarnessSlug {
    /// The third-party CLI harness catalog, in catalog order.
    ///
    /// These are the harnesses that ship a `harnesses/<slug>/harness.toml`
    /// manifest, install a CLI into the run container, and are shelled out to. It
    /// is what the registry, the `harnesses/` directory guard, and the `tcab
    /// harnesses` listing all enumerate. [`Gg`](HarnessSlug::Gg) is **not** here on
    /// purpose — it is the first-party in-container executor, invoked directly and registered on its
    /// own path (see [`crate::harness_registry`]); a wire slug that must resolve to
    /// *any* variant, gg included, goes through [`from_wire`](HarnessSlug::from_wire),
    /// and a surface that enumerates every harness a *run* can be queued for takes
    /// [`RUNNABLE`](HarnessSlug::RUNNABLE).
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

    /// Every harness a run can be **queued for**: the [CLI catalog](HarnessSlug::ALL)
    /// in catalog order, then [`Gg`](HarnessSlug::Gg).
    ///
    /// The distinction from `ALL` is *ships a CLI* versus *occupies the queue*. gg ships
    /// no manifest and installs no CLI, so it is rightly absent from the catalog — but its
    /// runs take a queue slot exactly as a third-party harness's do, and today they are
    /// most of the queue. So the surfaces that reason about runs in flight rather than
    /// about installed CLIs enumerate this list instead: the queue's per-harness
    /// parallelism caps and the coverage scheduler's capacity lanes, both of which would
    /// leave the majority of the queue untunable if they stopped at the catalog.
    ///
    /// Derived from `ALL` rather than written out again, so a harness added to the catalog
    /// becomes queue-tunable without a second edit.
    pub const RUNNABLE: [HarnessSlug; HarnessSlug::ALL.len() + 1] = {
        let mut out = [HarnessSlug::Gg; HarnessSlug::ALL.len() + 1];
        let mut i = 0;
        while i < HarnessSlug::ALL.len() {
            out[i] = HarnessSlug::ALL[i];
            i += 1;
        }
        out
    };

    /// Resolve a wire slug into a [`HarnessSlug`], across **every** variant —
    /// [`RUNNABLE`](HarnessSlug::RUNNABLE), which is [`ALL`](HarnessSlug::ALL) plus
    /// [`Gg`](HarnessSlug::Gg).
    ///
    /// Use this wherever a stored or received slug string must round-trip back to
    /// its variant regardless of run mode (for example the backend's model-price
    /// canonicalization); an `ALL`-only lookup would silently misread a `gg` slug.
    /// Returns `None` for an unrecognized value.
    pub fn from_wire(slug: &str) -> Option<HarnessSlug> {
        HarnessSlug::RUNNABLE
            .into_iter()
            .find(|h| h.as_str() == slug)
    }

    /// Whether this harness reaches its model **through OpenRouter** (it
    /// authenticates with `OPENROUTER_API_KEY`), as opposed to a provider-native
    /// endpoint. True for Cline, Goose, Kilo, OpenCode, and Pi; false for Codex
    /// (OpenAI), Claude (Anthropic), and Antigravity (Google). This governs
    /// whether a trailing `:free`-style OpenRouter variant tag is stripped when
    /// canonicalizing the model id (see [`crate::model_id`]). A drift test keeps
    /// this in step with each harness's `api_key_env`.
    ///
    /// Gg is included: for Phase 0 it reaches its model through OpenRouter with
    /// `OPENROUTER_API_KEY`, so its model ids canonicalize the same way (the
    /// `:free` route tag is stripped).
    pub fn routes_through_openrouter(self) -> bool {
        matches!(
            self,
            HarnessSlug::Cline
                | HarnessSlug::Goose
                | HarnessSlug::Kilo
                | HarnessSlug::Opencode
                | HarnessSlug::Pi
                | HarnessSlug::Gg
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
    ///
    /// Gg is intentionally **not** included: its in-container binary is the LLM
    /// client itself and addresses OpenRouter with the bare `provider/model` id, so
    /// it never needs the CLI-only `openrouter/` launch prefix.
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
            HarnessSlug::Gg => "gg",
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
            | HarnessSlug::Pi
            // Gg reaches its model through OpenRouter for Phase 0, so it draws from
            // the same OpenRouter model-slug namespace as the routed CLI harnesses.
            | HarnessSlug::Gg => HarnessFamily::Openrouter,
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
    /// (for example `one-shot`). For an external `--orchestrator-dir`
    /// this is the directory's own manifest slug, not the request's. Defaults to
    /// `one-shot` so records written before orchestrator selection existed — and
    /// hand-written fixtures — still deserialize. See
    /// [orchestrators](crate::OrchestratorCatalog).
    #[serde(default = "default_orchestrator_slug")]
    pub orchestrator_slug: String,
    /// The slug of the [engine](crate::engine) the produced build was written
    /// against (for example `simple-2d`), or `none` when the build supplied its
    /// own frame loop, input, audio, assets, and diagnostics.
    ///
    /// The engine is a **run dimension**, not a property of the case: the same
    /// case version can be run on several engines, and a result is only
    /// comparable with another result on the same engine, so the selection is
    /// recorded here beside the harness and the orchestrator rather than being
    /// inferred from the case. Defaults to `none` so records written before
    /// engine selection existed — and hand-written fixtures — still deserialize,
    /// which is also the truth about them: they had no runtime.
    #[serde(default = "default_engine_slug")]
    pub engine_slug: String,
    /// The version of the engine runtime that was vendored into the run
    /// repository, read out of the staged package at seed time.
    ///
    /// Separate from [`Self::engine_slug`] because an engine's contract moves
    /// under a stable slug: two `simple-2d` runs a release apart were given
    /// different frame, input, or host behaviour, and only the version
    /// distinguishes them. `None` for a run whose engine vendors no runtime
    /// (`none` has no package, so there is no version to read) and for records
    /// written before engine selection existed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub engine_version: Option<String>,
    /// The model ID passed to the harness, treated as an opaque string. For a gg
    /// run there is no single harness model (a run binds models to slots via
    /// [`Self::gg_capability_set`]); this carries the run's primary-slot model so a
    /// gg run still has a representative model identity for the existing per-model
    /// listings.
    pub model_id: String,
    /// The declarative [capability set](GgCapabilitySet) a **gg** run was configured
    /// with — which capabilities were on, their implementations/params, and the
    /// model-slot bindings — recorded verbatim so a gg result is traceable to the
    /// exact configuration that produced it and
    /// [result aggregation](https://docs.testcabinet.ai/gg/result-aggregation/) can
    /// slice by configuration. Present only for a gg run (`harness_slug` is
    /// [`HarnessSlug::Gg`]); `None` for every third-party-harness run, which is
    /// configured by the flat `(model, orchestrator)` dimensions instead.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub gg_capability_set: Option<GgCapabilitySet>,
    /// The compact, aggregatable [summary](GgSessionSummary) of a **gg** run's own
    /// outcome — total agents/subagent depth, compactions, whether it ran out of
    /// context, issue-review and speculation counts, issues created/completed, the
    /// per-slot cost rollup, the terminal status, and the execution ceiling that stopped
    /// it, when one did — computed by the gg binary from
    /// its telemetry and recorded here so
    /// [result aggregation](https://docs.testcabinet.ai/gg/result-aggregation/) can
    /// slice a run's outcome by its [`gg_capability_set`](Self::gg_capability_set)
    /// without re-parsing the whole event stream. Present only for a gg run that ran a
    /// session (the binary emitted a
    /// [`SessionSummary`](crate::gg::GgTelemetryKind::SessionSummary)); `None` for every
    /// third-party-harness run and for a gg run that failed to launch.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub gg_summary: Option<GgSessionSummary>,
}

/// The default orchestrator slug for records that predate orchestrator selection:
/// every such run was a single, one-shot harness session.
fn default_orchestrator_slug() -> String {
    crate::orchestrator::ONE_SHOT_SLUG.to_string()
}

/// The default engine slug for records that predate engine selection: every such
/// run built against no runtime at all, which is exactly what
/// [`NONE_SLUG`](crate::engine::NONE_SLUG) names.
fn default_engine_slug() -> String {
    crate::engine::NONE_SLUG.to_string()
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
/// harness exit splits into [`Completed`](RunState::Completed),
/// [`Catastrophic`](RunState::Catastrophic) (nothing to evaluate — the output
/// never built or loaded) and, when the output's dependency install never
/// succeeded, [`Infrastructure`](RunState::Infrastructure);
/// a harness that stopped itself on one of its own configured ceilings is
/// [`LimitExceeded`](RunState::LimitExceeded), one that exits **non-zero** any
/// other way is a [`HarnessError`](RunState::HarnessError), and one that stops
/// responding altogether is [`Hung`](RunState::Hung); a run stopped before the
/// harness finished is [`TimedOut`](RunState::TimedOut) (the runtime cap),
/// [`Canceled`](RunState::Canceled) (an operator killed it), or
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
    /// Reserved for a total failure to produce a runnable artifact: a tree with no
    /// `package.json`, or one whose build or load failed after its dependency
    /// install succeeded. A tree whose [dependency install](crate::install) did not
    /// succeed is not this — its output was never given a chance to build, so it is
    /// [`Infrastructure`](RunState::Infrastructure). An output that builds and loads
    /// is reviewable however badly it behaves: a missing or non-conformant debug API
    /// fails the individual checklist points its validation scripts back (see
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
    /// The agent harness stopped the run on one of its own **execution ceilings** —
    /// a turn count, a wall-clock budget, a spend, or a tolerance for failing turns
    /// — and exited on the code that says so.
    ///
    /// The ceilings are safeguards the run's own capability set arms, and they are
    /// not expected to be reached: a run that reaches one spent its whole allowance
    /// without finishing. That is the model's outcome and real signal about it, so
    /// this is publishable **without** a review as a per-model statistic, exactly as
    /// a [`HarnessError`](RunState::HarnessError) is, and it releases no source repo
    /// and no playable build — the harness stopped mid-task, so whatever is in the
    /// tree is work nobody said was finished.
    ///
    /// It is a distinct state because it is the one harness stop that must **not**
    /// be retried. Every other retryable failure can come out differently on a
    /// second attempt; a breached ceiling is a property of the configuration, so a
    /// retry spends another run reaching the same bound. See the backend's
    /// `is_retryable`.
    ///
    /// Only [gg](crate::gg) reaches it, because gg is the only harness whose
    /// ceilings the Test Cabinet configures.
    LimitExceeded,
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
    /// or pull, a pod was OOM-killed, seeding or the case's init step failed, or the
    /// collected tree's [dependency install](crate::install) did not succeed after
    /// its retries. Not the model's fault — retained with a diagnostic
    /// [`RunStatus::detail`] giving the reason, but **never** publishable and
    /// excluded from every model statistic. A run that reached the install carries
    /// its collected tree and its [validation summary](crate::validation::ValidationSummary),
    /// unlike the earlier failures, which produced neither. A harness that merely
    /// exited non-zero is a [`HarnessError`](RunState::HarnessError), not this.
    Infrastructure,
    /// An operator killed the run before it finished — a deliberate stop, not an
    /// outcome. **Never** publishable and excluded from every model statistic: nothing
    /// about the model can be concluded from a run a human ended.
    ///
    /// Only a killed [gg](crate::gg) run reaches this state, and reaching it is the
    /// point of gg's cooperative wind-down: gg observes the kill at a turn boundary and
    /// stops, so the run still finishes through its ordinary post-session path and is
    /// retained — with everything it streamed before the kill — visible and inspectable
    /// in the run list rather than vanishing. Killing a run of any other harness
    /// produces no record at all: such a harness has no wind-down to be asked for, so
    /// its driver destroys the run outright (see the driver's `cancel` module) and there
    /// is nothing to record this state on.
    ///
    /// Distinct from [`TimedOut`](RunState::TimedOut) and [`Hung`](RunState::Hung),
    /// the two terminations the Test Cabinet itself decides on a timer; this one has
    /// no timer and no fault, only an operator.
    Canceled,
}

impl RunState {
    /// Every terminal state, so callers that must enumerate them (the backend's
    /// wire-string lists, exhaustiveness tests) cannot silently miss a new one.
    pub const ALL: [RunState; 8] = [
        RunState::Completed,
        RunState::Catastrophic,
        RunState::TimedOut,
        RunState::HarnessError,
        RunState::LimitExceeded,
        RunState::Hung,
        RunState::Infrastructure,
        RunState::Canceled,
    ];

    /// Whether a run in this state may be published at all. Every state except
    /// [`Infrastructure`](RunState::Infrastructure) and
    /// [`Canceled`](RunState::Canceled) is publishable — completed runs through the
    /// review gate, the failure tiers through the separate publish-failures path.
    /// Those two are retained for inspection only: neither says anything about the
    /// model.
    pub fn is_publishable(self) -> bool {
        !matches!(self, RunState::Infrastructure | RunState::Canceled)
    }

    /// Whether this state is one of the publishable *failure* tiers
    /// ([`Catastrophic`](RunState::Catastrophic),
    /// [`TimedOut`](RunState::TimedOut),
    /// [`HarnessError`](RunState::HarnessError),
    /// [`LimitExceeded`](RunState::LimitExceeded), or [`Hung`](RunState::Hung)):
    /// publishable without a review and excluded from the reviewer checklist score.
    pub fn is_publishable_failure(self) -> bool {
        matches!(
            self,
            RunState::Catastrophic
                | RunState::TimedOut
                | RunState::HarnessError
                | RunState::LimitExceeded
                | RunState::Hung
        )
    }

    /// Whether publishing a run in this state **releases** its produced artifacts —
    /// a public source repository and (when it built) a playable build. True for the
    /// code-carrying states ([`Completed`](RunState::Completed),
    /// [`Catastrophic`](RunState::Catastrophic),
    /// [`TimedOut`](RunState::TimedOut)); false for a
    /// [`HarnessError`](RunState::HarnessError) and a
    /// [`LimitExceeded`](RunState::LimitExceeded), which are recorded only as
    /// per-model statistics and release nothing, and for the never-published
    /// [`Infrastructure`](RunState::Infrastructure) and
    /// [`Canceled`](RunState::Canceled). Note this is about the *release*
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
    /// that release nothing at all ([`HarnessError`](RunState::HarnessError),
    /// [`LimitExceeded`](RunState::LimitExceeded), [`Hung`](RunState::Hung),
    /// [`Infrastructure`](RunState::Infrastructure), and
    /// [`Canceled`](RunState::Canceled)).
    pub fn has_playable_build(self) -> bool {
        matches!(self, RunState::Completed)
    }

    /// Whether a run in this state carries a functional rating and a checklist
    /// score at all. True only for [`Completed`](RunState::Completed): the checklist
    /// is decided against a build that loaded, so every other tier is **unscored**
    /// — a [`Catastrophic`](RunState::Catastrophic) run never loaded, a
    /// [`TimedOut`](RunState::TimedOut) one never finished, and the rest released
    /// nothing — and each is reported as its own per-model statistic instead.
    ///
    /// This is the gate the store's rating and score seams apply *before* consulting
    /// the validators: on a validator-rated version an unloaded build ran no
    /// validator, and zero failures would otherwise read as a flawless run.
    pub fn is_scored(self) -> bool {
        matches!(self, RunState::Completed)
    }

    /// Classify a run that failed *before* producing an implementation. A harness
    /// session stopped at the run's maximum runtime is a model outcome (the model
    /// never converged) → [`TimedOut`](RunState::TimedOut); the harness (or its
    /// orchestrator runner) exiting non-zero is a
    /// [`HarnessError`](RunState::HarnessError) — the model drove it to exit early;
    /// a harness that stopped itself on one of its own configured execution
    /// ceilings is [`LimitExceeded`](RunState::LimitExceeded), which is held apart
    /// from a harness error because it must not be retried;
    /// a harness that went silent and was killed by the idle watchdog is
    /// [`Hung`](RunState::Hung); every other error — the harness-install or
    /// case-init timeouts and container/cluster faults — is the Test Cabinet's
    /// [`Infrastructure`](RunState::Infrastructure).
    ///
    /// [`Canceled`](RunState::Canceled) is reached by one error only, a run the
    /// engine refused to launch a session for because its operator had already
    /// killed it ([`CanceledBeforeSession`](crate::Error::CanceledBeforeSession)).
    /// Every other operator kill is observed out-of-band by the driver, which sets
    /// the state itself, and never surfaces as an error the run returns.
    pub fn classify_failure(err: &crate::Error) -> RunState {
        match err {
            crate::Error::RunTimedOut { .. } => RunState::TimedOut,
            crate::Error::HarnessInvocation { .. } => RunState::HarnessError,
            crate::Error::HarnessLimitExceeded { .. } => RunState::LimitExceeded,
            crate::Error::HarnessHung { .. } => RunState::Hung,
            crate::Error::CanceledBeforeSession => RunState::Canceled,
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
    /// the backend serves the prior runs' READMEs (matched on the same jam and model,
    /// across harnesses) back to a new run, which seeds them and is asked to build
    /// something distinct. Kept out of a run's other surfaces — it exists to brief the
    /// *next* run, not to be displayed. Defaulted and omitted when absent so records
    /// written before the field existed still deserialize and non-jam records stay
    /// slim.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub game_jam_readme: Option<String>,
    /// How many times each tool the harness's agent invoked was called over the
    /// run, keyed by lowercased raw tool name — **including** tools recognized and
    /// consumed without emitting an event (the todo tools). Lifted from
    /// [`HarnessOutcome::tool_calls`](crate::harness::HarnessOutcome::tool_calls) so
    /// a harness comparison can diagnose tool-call behavior (a re-reading or
    /// over-shelling harness shows here) that a count derived from the event stream
    /// alone would miss. Defaulted and omitted when
    /// empty so records written before the field existed still deserialize, and a
    /// gg run — whose per-tool detail comes from its own telemetry — carries none.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub tool_calls: BTreeMap<String, u64>,
    /// The earlier entries this **game-jam** run was seeded with and briefed to build
    /// something distinct from: every prior run of the same jam by the same model whose
    /// gameplay README was written into the run's `previous-entries/` folder, oldest
    /// first — README body included, exactly as this run was shown it.
    ///
    /// Empty for a jam's first run by a model (and for every other test type). Unlike
    /// [`game_jam_readme`](Self::game_jam_readme) these *are* meant to be shown: they
    /// are inputs to the run, the only ones not shared with every other run of the jam,
    /// and the Inputs tab renders each README inline beside the jam's prompt and specs.
    /// The bodies are carried here rather than looked up from the runs that produced
    /// them, because that is what makes them readable as inputs — a prior run may never
    /// be published, and a record has to stand on its own. Defaulted and omitted when
    /// empty so records written before the field existed still deserialize.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub game_jam_prior_entries: Vec<PriorGameJamEntry>,
    /// The commit hash of the run's **seed** commit — the single commit
    /// [`RepoSeeder::seed`](crate::execution::RepoSeeder::seed) makes after laying
    /// down the specs, assets, and rendered reference images, before the container
    /// ever starts. Everything reachable from it is scaffolding the run was given;
    /// everything else in the produced tree is the model's own work.
    ///
    /// Recorded because it is the only *exact* answer to "which files did the model
    /// write?", and it is computed host-side where nothing the model does can affect
    /// it. The obvious substitute — treat the produced tree's root commit as the seed
    /// — fails in the worst direction: a model that amends, squashes, rebases, or
    /// re-runs `git init` folds its own work into the root commit, so the seeded set
    /// swallows the authored files and the run reports near-zero authored code
    /// *stamped as an exact measurement*. See
    /// [code analysis](https://docs.testcabinet.ai/gg/analysis/code-analysis/) for the
    /// basis ladder that falls back when this field is absent.
    ///
    /// Distinct from, and authoritative over, a gg session record's `baselineCommit`: that is
    /// gg's own in-container observation of the same commit, and a mismatch between
    /// them is diagnostic rather than redundant.
    ///
    /// Defaulted and omitted when absent so records written before the field existed
    /// still deserialize, and a run that failed before its workspace was seeded — which
    /// has no seed commit to name — serializes without the key rather than with an
    /// empty string that would read as a real hash.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub seed_commit: Option<String>,
    /// The **bounded** tier of the run's [code analysis](crate::code_analysis): a
    /// deterministic, execute-nothing static read of the code the model wrote,
    /// computed on the host at the [post-run seam](crate::post_run) — after the tree
    /// is collected and **before** validation rewrites it.
    ///
    /// Roughly ninety-five scalars, every leaf a number, a boolean or a small enum, so
    /// the whole block flattens into the query language's `code.*` namespace and is
    /// directly aggregable. The unbounded tier — every file, symbol, import edge, cycle
    /// and clone group — is the run tree's
    /// [`code-analysis.json.gz`](crate::code_analysis::CODE_ANALYSIS_TREE_ARTIFACT)
    /// artifact instead, because a record is deserialized on every run listing.
    ///
    /// **Nothing in here influences the run's score or verdict.** A run is judged on
    /// what it built, never on what a metric said about it; the polarity a metric
    /// definition carries orients a sort and nothing else.
    ///
    /// Absent for a run whose host wired no analyzer, for a run analysed by a build
    /// that predates the analyzer, and for a run whose tree could not be read at all.
    /// Defaulted and omitted when absent so records written before the field existed
    /// still deserialize, and so a run that carries no analysis is not confused with
    /// one that measured an empty tree — the distinction that
    /// [`CodeAuthoredBasis`](crate::code_analysis::CodeAuthoredBasis) exists to keep
    /// honest.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub code_analysis: Option<CodeAnalysisSummary>,
    /// What the case's [`[toolchain]`](crate::toolchain) commands did when they were
    /// run over the produced implementation at the
    /// [post-run seam](crate::post_run), together with the build smoke check.
    ///
    /// **This is the one analysis block that can influence a run's rating**, and it
    /// does so through exactly one field: a `typecheck` that ran and exited non-zero
    /// [gates](crate::toolchain::ToolchainSummary::gates) the run, which rates it
    /// `broken` and scores it zero, because code that does not compile is not
    /// reviewable. The lint, format and test results are recorded and gate nothing.
    /// The gate is applied where the aggregate rating and score are computed
    /// ([`crate::review::gated_rating`]), never by rewriting a reviewer's marks.
    ///
    /// Absent for a run whose case declares no `[toolchain]` table, for a canceled
    /// run, for a run whose tree never reached the host, and for every record written
    /// before the field existed. Absence is *not checked*, and it never gates — the
    /// distinction the `Option` exists to keep.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub toolchain: Option<ToolchainSummary>,
    /// The run's showcase: the model's own presentation of the game it built — a
    /// player-facing description and a short, ordered media carousel — captured
    /// from the produced tree's `showcase/` directory at record assembly (see
    /// `docs/showcase.md`). The Play page renders it around the playable build.
    ///
    /// Absent for a run whose tree carried no parseable showcase and for every
    /// record written before the field existed; a showcase problem never fails a
    /// run and never degrades its status, so absence says nothing about the run
    /// beyond "there is nothing to show". Defaulted and omitted when absent so
    /// older records still deserialize.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub showcase: Option<RunShowcase>,
}

impl RunRecord {
    /// **The gate predicate for a whole run.** Whether an automated check
    /// disqualified this run from being rated by its reviews.
    ///
    /// Today there is exactly one such check — the case's gating `typecheck` — and
    /// this is the single place the rest of the system asks about it, so a second
    /// one lands here rather than in every consumer. A record with no toolchain
    /// block never gates.
    pub fn gated_broken(&self) -> bool {
        self.toolchain.as_ref().is_some_and(ToolchainSummary::gates)
    }
}

/// One earlier game-jam run's gameplay README, as served back to a new run of the
/// same jam by the same model (under any harness) so the new run can build something
/// distinct from what came before.
///
/// One type serves both ends of that trip: it is what the backend returns from
/// `GET /game-jams/{slug}/prior-readmes` and the driver threads into seeding and the
/// prompt, *and* what the new run records in
/// [`RunRecord::game_jam_prior_entries`](RunRecord::game_jam_prior_entries) as the
/// inputs it was given. The `readme` is the prior run's captured
/// [`RunRecord::game_jam_readme`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct PriorGameJamEntry {
    /// The prior run's id, carried so an entry can be traced back to its run.
    pub run_id: String,
    /// RFC 3339 timestamp of when the prior run finished, used to order and label
    /// the entries (oldest first) when they are seeded.
    pub finished_at: String,
    /// The gameplay README the prior run produced.
    pub readme: String,
}

/// A run's showcase: the model's own presentation of the game it built, captured
/// onto the record from the produced tree's `showcase/` directory (see
/// `docs/showcase.md`). The description is `showcase/showcase.md`; the carousel is
/// `showcase/showcase.toml`'s `[[media]]` tables, in their declared order.
///
/// The media *bytes* do not ride the record — they are uploaded from the produced
/// tree and served per run at `/runs/<id>/showcase/<file>` alongside the run's
/// proof, asset, and validation media; this block carries only the description
/// text and the carousel's file names, captions, and kinds.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct RunShowcase {
    /// The player-facing markdown description, in the style of a store page. It may
    /// reference images beside it in `showcase/` by bare relative path
    /// (`![Title](title.png)`), which a renderer resolves against the run's served
    /// showcase files. Capped at capture; a longer description is truncated on a
    /// char boundary with a trailing marker.
    pub description: String,
    /// The media carousel, in the order the model declared it — carousel order is
    /// presentation order. Capped at capture; entries whose files were missing or
    /// oversized were dropped there, so every entry named here was present and
    /// within bounds when the record was assembled.
    pub media: Vec<ShowcaseMedia>,
}

/// One entry of a [showcase](RunShowcase)'s media carousel.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ShowcaseMedia {
    /// The media file's name in the run's `showcase/` directory (a plain file name,
    /// no subdirectories), which is also its name under the run's served
    /// `/runs/<id>/showcase/<file>` route.
    pub file: String,
    /// The model's short caption for this entry.
    pub name: String,
    /// The kind of media, inferred from the file's extension by the same rule as a
    /// declared proof ([`MediaKind::from_path`]): `.png` an image, `.json.gz` a
    /// draw-command replay, `.webm` a video.
    pub kind: MediaKind,
}

#[cfg(test)]
#[path = "run_record.test.rs"]
mod tests;
