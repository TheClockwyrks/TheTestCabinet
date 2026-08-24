//! The **gg** run-enqueue endpoint (`POST /gg/runs`).
//!
//! gg is The Test Cabinet's own first-party coding harness and a distinct **run
//! mode**: unlike a third-party-harness run — a flat `(harness, model,
//! orchestrator)` tuple submitted through [`POST /jobs`](super::jobs::launch) — a gg
//! run is configured by a declarative [capability set](GgCapabilitySet) (which
//! capabilities are on, their implementations/params, and how models bind to
//! [slots](test_cabinet_core::gg::GgSlotBinding)). This endpoint gives that run mode
//! its own gg-native request shape rather than overloading the flat launch body.
//!
//! It reuses the whole downstream substrate unchanged: the handler maps a
//! [`GgRunRequest`] onto a [`LaunchBody`] with the harness fixed to
//! [`HarnessSlug::Gg`] and the capability set carried in
//! [`LaunchBody::gg_capability_set`], then enqueues it through the same
//! [`build_new_job`] path every run takes. The
//! dispatcher claims it, the driver rebuilds the gg [`RunRequest`] from the stored
//! launch body, and core takes its gg branch — so a gg run is observed through the
//! very same live monitor (`GET /jobs/{id}/live`), status, and active-run list.
//!
//! [`RunRequest`]: test_cabinet_core::RunRequest

#[cfg(test)]
#[path = "gg.test.rs"]
mod tests;

use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::{Deserialize, Serialize};

use test_cabinet_core::LaunchBody;
use test_cabinet_core::gg::GgCapabilitySet;
use test_cabinet_core::run_record::HarnessSlug;

use crate::auth::AuthUser;
use crate::error::ApiError;

use super::AppState;
use super::jobs::{
    LaunchAck, LaunchQuery, attribution, build_new_job, launch_models, now_rfc3339,
    resolve_gg_model_facts,
};

/// The default variant a gg run targets when the request omits one — the same
/// baseline variant every case defines.
fn default_variant() -> String {
    "base".to_string()
}

/// The body of `POST /gg/runs`: a **gg-native** run request. Only the test case,
/// version, and variant carry over from a conventional run (those are
/// test-case-level); everything a third-party run expresses as `(model,
/// orchestrator)` is instead expressed by the [capability set](GgCapabilitySet),
/// which binds the models (to [slots](test_cabinet_core::gg::GgSlotBinding)) and
/// selects the capabilities. There is deliberately no `harness` field — this
/// endpoint runs the gg harness by construction — and no `orchestrator` field: gg
/// is its own executor and the orchestrator dimension does not apply.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgRunRequest {
    /// Test-case slug to run (e.g. `carom`).
    pub test_case: String,
    /// Exact, immutable test-case version (e.g. `v1.0.0`).
    pub version: String,
    /// Variant to run. Defaults to `base` when omitted.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub variant: Option<String>,
    /// The declarative capability set configuring the run: its agent profiles (each
    /// with its own capabilities, model binding, and delegation graph) and the
    /// run-level model slots and limits. Must bind a model to its
    /// [root agent](GgCapabilitySet::root).
    pub capability_set: GgCapabilitySet,
    /// Optional override for the maximum harness runtime, in seconds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub max_runtime_seconds: Option<u64>,
    /// How many times to automatically retry this run after a terminal failure The
    /// Test Cabinet (or a catastrophic build) is responsible for. Defaults to `1`
    /// (one retry) when omitted; `0` disables retries. The backend clamps it to a
    /// sane maximum. Same semantics as a conventional run's `retryCount`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub retry_count: Option<u32>,
    /// Built-in [engine](test_cabinet_core::engine) slug the produced build is
    /// written against. Omit for the `none` default, which supplies no runtime.
    ///
    /// A gg run seeds and builds a workspace like any other run, so it carries the
    /// engine dimension on the same terms: the slug must be one the engine
    /// catalogue knows and one the requested case version declares support for,
    /// both checked when the run executes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub engine: Option<String>,
}

impl GgRunRequest {
    /// The variant this run targets, resolving an omitted one to the
    /// [`default_variant`].
    fn resolved_variant(&self) -> String {
        self.variant.clone().unwrap_or_else(default_variant)
    }

    /// Lower this gg-native request onto the canonical [`LaunchBody`] the enqueue
    /// substrate speaks: the harness fixed to [`HarnessSlug::Gg`], the capability set
    /// carried through, and the [root agent](GgCapabilitySet::root)'s model lifted into
    /// [`LaunchBody::model`] so a gg run still has a representative model identity for
    /// the existing per-model listings and the active-run summary.
    ///
    /// Returns the human-readable reason when the capability set does not bind a
    /// model to its root agent — the one gg-specific precondition the flat
    /// [`build_new_job`] validation cannot express.
    fn into_launch_body(self) -> Result<LaunchBody, String> {
        // The identity half first, on the set as the console authored it: the internal ids are
        // still here, so this is the last place a reference can be judged against the ids it names.
        if let Some(defect) = super::gg_config::authored_capability_set_defect(&self.capability_set)
        {
            return Err(format!(
                "the gg capability set cannot be launched: {defect}"
            ));
        }
        // Then the resolution itself. Every reference is rewritten to the profile's slug and the
        // ids are dropped, so what is stored, what the container reads and what the run records
        // name a profile by the one name the operator wrote and the model was shown.
        let capability_set = self.capability_set.resolve_agent_keys();
        if let Some(defect) = super::gg_config::launched_capability_set_defect(&capability_set) {
            return Err(format!(
                "the gg capability set cannot be launched: {defect}"
            ));
        }
        // Every [model slot](test_cabinet_core::gg::GgModelSlot) a configuration declares
        // is filled in by the launch form, so a set arriving here with an agent still
        // deferred was launched incompletely — reject it now, by name, rather than letting
        // the run reach a container and fail its check there.
        let unresolved = capability_set.unresolved_agents();
        if !unresolved.is_empty() {
            return Err(format!(
                "the gg capability set leaves the {} agent(s) without a model; \
                 bind a model to every declared model slot before launching",
                unresolved
                    .iter()
                    .map(|agent| format!("`{agent}`"))
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
        }
        // The root is the *first* profile a set declares, whatever it is named — a configuration
        // may rename it or promote another profile to it — so an empty set is what "there is no
        // root" looks like, and the model is lifted off whichever profile is first.
        if capability_set.agents.is_empty() {
            return Err(
                "the gg capability set declares no agent profiles; it must declare at least one"
                    .to_string(),
            );
        }
        // A root that is an [FSM shell](GgAgentConfig::is_fsm_shell) has no model of its own — a
        // machine takes no turns — so the run's model is the one its entry state runs, which is
        // the model the session's very first turn is actually charged to.
        //
        // A machine that cannot say which agent it enters is refused here by the name that is
        // actually missing, never resolved back to the shell: the shell is the one profile in the
        // set that is *supposed* to carry no model, so reporting it would name the only agent whose
        // empty binding is correct — and a shell left holding a stray `modelId` would sail through
        // and record the whole run against a model nothing asked it to run.
        let root = capability_set.root();
        let runner = capability_set
            .dispatched_agent(&root.slug)
            .map_err(|err| format!("the gg capability set cannot be launched: {err}"))?;
        let model = runner
            .resolved_model_id()
            .ok_or_else(|| {
                if runner.id == root.id {
                    format!(
                        "the gg capability set must bind a model to its root agent (`{}`)",
                        root.slug
                    )
                } else {
                    // The root is a machine, so the agent needing the binding is the one its
                    // entry state runs — named alongside the machine, because an operator
                    // reading this is looking at a root profile with no model field at all.
                    format!(
                        "the gg capability set must bind a model to the `{}` agent, which its \
                         root agent (`{}`) enters first",
                        runner.slug, root.slug
                    )
                }
            })?
            .to_string();
        let variant = self.resolved_variant();
        Ok(LaunchBody {
            test_case: self.test_case,
            version: self.version,
            variant,
            harness: HarnessSlug::Gg,
            model,
            // gg is its own executor; the orchestrator dimension does not apply. The
            // engine takes the gg branch and never conducts an orchestrator.
            orchestrator: None,
            // The engine dimension does apply: a gg run seeds and builds a
            // workspace like any other run, so it selects the runtime that
            // workspace is written against.
            engine: self.engine,
            max_runtime_seconds: self.max_runtime_seconds,
            auth_mode: None,
            retry_count: self.retry_count,
            gg_capability_set: Some(capability_set),
            // Resolved from the model catalog by the handler, which has the database
            // this lowering does not; never taken from the request.
            gg_model_windows: Default::default(),
            gg_model_modalities: Default::default(),
        })
    }
}

/// `POST /gg/runs` — enqueue a **gg** run. Requires a bearer token (the launching
/// account), the same gate as [`POST /jobs`](super::jobs::launch).
///
/// The handler validates the request — the test-case version must be ingested (and
/// not an experimental version the deployment has not opted into), the variant must
/// exist, and the capability set must bind a model to its
/// [root agent](GgCapabilitySet::root) — then
/// enqueues a `queued` job carrying the gg launch body verbatim. It returns the same
/// [`LaunchAck`] a conventional launch does, so the console watches a gg run through
/// the existing `GET /jobs/{id}` status and `GET /jobs/{id}/live` monitor unchanged.
///
/// The run is **attributed** to the token's account (`job.user_id`) and to no
/// [origin](super::jobs::LaunchQuery::origin): a gg run is always launched by hand
/// through this endpoint, so — exactly like a launch from the console's conventional
/// run form — it is never swept up by a coverage plan's or ladder's scoped halt. A
/// plan's top-up mints its own jobs (see [`super::coverage::enqueue_top_up`]) and
/// never reaches this handler, so there is no scheduling origin for it to carry.
#[tracing::instrument(
    name = "gg.launch",
    skip(state, user, body),
    fields(case.slug = %body.test_case, case.version = %body.version),
    err(Debug),
)]
pub async fn launch_gg(
    State(state): State<AppState>,
    user: AuthUser,
    Json(body): Json<GgRunRequest>,
) -> Result<Response, ApiError> {
    let variant = body.resolved_variant();
    // The case version must be a real, ingested one before a run against it is
    // queued — a gg run burns a container and a model just like any other, so a typo
    // should fail here, not after setup. `read_manifest` 404s an unknown version.
    let manifest = state
        .store
        .read_manifest(&body.test_case, &body.version)
        .map_err(ApiError::from)?;
    // An experimental version the deployment has not opted into is treated as if it
    // does not exist, so it cannot be run even by a client that guessed its slug.
    if manifest.experimental && !state.config.allow_experimental {
        return Err(ApiError::not_found(format!(
            "test-case version `{}@{}` is not ingested",
            body.test_case, body.version
        )));
    }
    // The variant must be one the case actually defines.
    if !manifest.variants.iter().any(|v| v.slug == variant) {
        return Err(ApiError::bad_request(format!(
            "test-case version `{}@{}` has no variant `{variant}`",
            body.test_case, body.version
        )));
    }

    let mut launch = body.into_launch_body().map_err(ApiError::bad_request)?;
    // Price every model this run binds at enqueue, the same seeding `POST /jobs`
    // performs, so the catalog can split the run's cost per token class from its
    // first turn instead of only after the run completes. Missing-only and
    // best-effort: an already-priced model costs nothing, and an unpriced one
    // costs a cost split, not the launch. It also runs before the window
    // resolution below, which then usually finds the window already on record.
    crate::bootstrap::seed_launch_prices(&state.db, &state.prices, &launch_models(&launch)).await;
    // Tell the run what the catalog knows about the models it binds — the context
    // window each agent's fullness accounting and compaction trigger are measured
    // against. gg keeps no model table of its own and assumes no default, so a model
    // whose window cannot be resolved (not in the catalog, and not listed by
    // OpenRouter either) is rejected here rather than run against a guess.
    resolve_gg_model_facts(&state.db, &state.prices, &mut launch)
        .await
        .map_err(ApiError::bad_request)?;
    let now = now_rfc3339()?;
    // The launching account, and deliberately no origin: this endpoint is the by-hand
    // launch path, and it takes no `origin` query the way `POST /jobs` does because
    // nothing schedules a gg run through it.
    let attribution = attribution(&user, &LaunchQuery::default())?;
    // The type comes from the manifest already read above, so a gg run's job row
    // carries the same test type a conventional launch's does — which is what the
    // queue serializes the must-not-overlap run types on.
    let new = build_new_job(&launch, manifest.test_type, &now, &attribution)
        .map_err(ApiError::bad_request)?;
    let id = new.id.clone();

    state.db.enqueue_job(new).await.map_err(ApiError::from)?;

    let ack = LaunchAck {
        job_id: id.clone(),
        status_url: format!("/jobs/{id}"),
        live_url: format!("/jobs/{id}/live"),
    };
    Ok((StatusCode::ACCEPTED, Json(ack)).into_response())
}
