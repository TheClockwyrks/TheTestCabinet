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

use std::collections::HashMap;

use axum::Json;
use axum::extract::{Query, State};
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
    /// substrate speaks, by way of the two halves every gg launch shares:
    /// [`gg_launch_identity`] validates the capability set and lifts the model the run
    /// is recorded against, and [`gg_launch_body`] assembles the body around it.
    ///
    /// Returns the human-readable reason when the capability set cannot be launched —
    /// the gg-specific preconditions the flat [`build_new_job`] validation cannot
    /// express.
    fn into_launch_body(self) -> Result<LaunchBody, String> {
        let identity = gg_launch_identity(&self.capability_set)?;
        let variant = self.resolved_variant();
        Ok(gg_launch_body(
            GgLaunchSubject {
                test_case: self.test_case,
                version: self.version,
                variant,
                engine: self.engine,
                max_runtime_seconds: self.max_runtime_seconds,
                retry_count: self.retry_count,
            },
            identity,
        ))
    }
}

/// Everything a gg run needs that its [capability set](GgCapabilitySet) does not carry:
/// what it is run **on**, and the per-run overrides.
///
/// A launch is exactly this plus a [`GgLaunchIdentity`], which is what lets a run
/// launched by hand through [`launch_gg`] and one a coverage plan's top-up enqueues
/// ([`super::coverage::enqueue_top_up`]) be assembled by the same code rather than by two
/// copies that drift.
pub(super) struct GgLaunchSubject {
    /// Test-case slug to run.
    pub test_case: String,
    /// Exact, immutable test-case version.
    pub version: String,
    /// The resolved variant — never the request's `Option`, because a launch runs one.
    pub variant: String,
    /// The [engine](test_cabinet_core::engine) slug the produced build is written
    /// against, or `None` for the `none` default.
    pub engine: Option<String>,
    /// Override for the maximum harness runtime, in seconds.
    pub max_runtime_seconds: Option<u64>,
    /// How many automatic retries the run may take, or `None` for the backend default.
    pub retry_count: Option<u32>,
}

/// A capability set lowered to the form a run is **launched and recorded** in: every
/// reference resolved to a profile slug, and the model the run's identity is taken from.
///
/// The two travel together because they are decided together: the model is lifted off the
/// resolved set's root (or, for a machine root, the agent it enters first), so a caller
/// holding one without the other could pair a set with a model nothing in it runs.
pub(super) struct GgLaunchIdentity {
    /// The set as the run records it — [agent keys resolved](GgCapabilitySet::resolve_agent_keys),
    /// slot declarations gone, every binding pinned, and its
    /// [`preset_id`](GgCapabilitySet::preset_id) reduced to the
    /// [bare configuration id](saved_config_id) the run's coverage cell is keyed on.
    pub capability_set: GgCapabilitySet,
    /// The model the run is attributed to: the one its very first turn is charged to.
    pub model: String,
}

/// The bare id of the saved gg configuration a textual reference names, or `None` when it
/// names none.
///
/// One rule for the two places a configuration is named by text: the
/// [member](super::ReviewPlanCombo::gg_config_ref) a plan or a ladder stores, and the
/// [`preset_id`](GgCapabilitySet::preset_id) a launch records on the set it runs. The
/// console's picker values a configuration as `saved:<id>` and a client may just as
/// reasonably send the id alone; both name the same configuration, so both must key
/// identically — a member written one way and a run launched the other way are one
/// [coverage cell](https://docs.testcabinet.ai/components/backend/coverage/) or the plan
/// never fills.
///
/// A blank reference names nothing. Recorded as an id it would be indistinguishable from the
/// empty segment a set assembled by hand carries, quietly filing the run into the cell those
/// share.
pub(super) fn saved_config_id(reference: &str) -> Option<&str> {
    let id = reference.trim();
    let id = id.strip_prefix("saved:").unwrap_or(id);
    (!id.is_empty()).then_some(id)
}

/// The current name of every configuration in `refs` that `user_id`'s account holds, keyed
/// by the [bare id](saved_config_id) each reference names.
///
/// Resolved in one pass ahead of the launches that use it, so a batch naming one
/// configuration a hundred times reads it once and a store failure fails the request rather
/// than being reported as one run's validation error.
pub(super) async fn launch_configuration_names<'a>(
    db: &crate::db::Db,
    user_id: &str,
    refs: impl IntoIterator<Item = &'a str>,
) -> Result<HashMap<String, String>, ApiError> {
    let ids: std::collections::BTreeSet<&str> =
        refs.into_iter().filter_map(saved_config_id).collect();
    let mut names = HashMap::new();
    for id in ids {
        if let Some(config) = db
            .get_gg_config(user_id, id)
            .await
            .map_err(ApiError::from)?
        {
            names.insert(id.to_string(), config.name);
        }
    }
    Ok(names)
}

/// Bind one launch's capability set to the configuration it claims to come from, given the
/// [names](launch_configuration_names) the launching account's library resolved to, or say
/// why the launch is refused.
///
/// Every endpoint that enqueues a gg run applies this, because the id it writes is the run's
/// [coverage cell](https://docs.testcabinet.ai/components/backend/coverage/) identity.
/// Unchecked, a client could file its runs into a cell it names but cannot see, and — because
/// coverage counts are global — into another account's, where they would satisfy a target
/// that account never asked for. Refused rather than quietly dropped, because dropping the id
/// would record the run as hand-assembled and leave the operator watching a cell that never
/// fills.
///
/// The id is reduced to its [bare form](saved_config_id) here, and the name recorded beside
/// it is the configuration's **now** rather than the one the client held when it last loaded
/// its picker: a run is sliced by `preset` in the run log and in a comparison, so a
/// configuration renamed in another tab would otherwise split its own runs across two labels.
///
/// A set naming no configuration is left exactly as it arrived. That is every launch the
/// new-run form assembles by hand, and it belongs to no configuration's cell.
pub(super) fn bind_launch_configuration(
    set: &mut GgCapabilitySet,
    names: &HashMap<String, String>,
) -> Result<(), String> {
    let Some(reference) = set.preset_id.clone() else {
        return Ok(());
    };
    let Some(config_id) = saved_config_id(&reference) else {
        set.preset_id = None;
        return Ok(());
    };
    let Some(name) = names.get(config_id) else {
        return Err(format!(
            "no gg configuration `{config_id}` on this account; a run is attributed to a \
             configuration the launching account owns"
        ));
    };
    set.preset = Some(name.clone());
    set.preset_id = Some(config_id.to_string());
    Ok(())
}

/// Validate a gg capability set for launch and lift the model the run is recorded
/// against, or say why it cannot be launched.
///
/// This is the whole of gg's launch-time judgement, in one place because two callers make
/// that judgement — the by-hand [`launch_gg`] and a coverage plan's or ladder's top-up —
/// and a member a plan accepts must be a member `POST /gg/runs` would accept. It reads
/// the set as the console **authored** it: the internal ids are still on the document, so
/// this is the last place a reference can be judged against the ids it names.
pub(super) fn gg_launch_identity(set: &GgCapabilitySet) -> Result<GgLaunchIdentity, String> {
    // The identity half first, on the set as the console authored it: the internal ids are
    // still here, so this is the last place a reference can be judged against the ids it names.
    if let Some(defect) = super::gg_config::authored_capability_set_defect(set) {
        return Err(format!(
            "the gg capability set cannot be launched: {defect}"
        ));
    }
    // Then the resolution itself. Every reference is rewritten to the profile's slug and the
    // ids are dropped, so what is stored, what the container reads and what the run records
    // name a profile by the one name the operator wrote and the model was shown.
    let mut capability_set = set.resolve_agent_keys();
    // The configuration this launch came from, in the one spelling everything else uses. The
    // id is what the run's coverage cell is keyed on, so a picker key (`saved:<id>`) or a
    // padded paste has to become the bare id here — before the set is stored, recorded and
    // counted — rather than at each of the places that later read it back.
    capability_set.preset_id = capability_set
        .preset_id
        .as_deref()
        .and_then(saved_config_id)
        .map(str::to_string);
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
    Ok(GgLaunchIdentity {
        capability_set,
        model,
    })
}

/// Assemble the canonical [`LaunchBody`] for a gg run: the harness fixed to
/// [`HarnessSlug::Gg`], the resolved capability set carried through, and its
/// [identity](GgLaunchIdentity) model lifted into [`LaunchBody::model`] so a gg run still
/// has a representative model for the per-model listings and the active-run summary.
///
/// Takes an identity rather than a raw set so it cannot be reached without the validation
/// [`gg_launch_identity`] performs: assembling a body is not where a bad set is caught.
pub(super) fn gg_launch_body(subject: GgLaunchSubject, identity: GgLaunchIdentity) -> LaunchBody {
    LaunchBody {
        test_case: subject.test_case,
        version: subject.version,
        variant: subject.variant,
        harness: HarnessSlug::Gg,
        model: identity.model,
        // gg is its own executor; the orchestrator dimension does not apply. The
        // engine takes the gg branch and never conducts an orchestrator.
        orchestrator: None,
        // The engine dimension does apply: a gg run seeds and builds a
        // workspace like any other run, so it selects the runtime that
        // workspace is written against.
        engine: subject.engine,
        max_runtime_seconds: subject.max_runtime_seconds,
        auth_mode: None,
        retry_count: subject.retry_count,
        gg_capability_set: Some(identity.capability_set),
        // Resolved from the model catalog by the handler, which has the database
        // this lowering does not; never taken from the request.
        gg_model_windows: Default::default(),
        gg_model_providers: Default::default(),
        gg_model_modalities: Default::default(),
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
/// A launch **from a saved configuration** says so by setting the capability set's
/// [`preset_id`](GgCapabilitySet::preset_id) to that configuration's id — which is what puts
/// the run in the same
/// [coverage cell](https://docs.testcabinet.ai/components/backend/coverage/) a plan or a
/// ladder scheduling the same configuration files its runs into. The id must name a
/// configuration the **launching account owns**, or the launch is refused: a run recording an
/// id its launcher cannot resolve claims a cell nobody can explain, and the operator who
/// wanted the attribution would find the cell they were filling still reading zero. The
/// configuration's **current** name is stamped on beside it, so the label the run log slices
/// by is the one the configuration bears rather than the one the client last read. A set
/// assembled by hand omits the id and is attributed to no configuration.
///
/// The run is **attributed** to the token's account (`job.user_id`) and to the
/// [origin](super::jobs::LaunchQuery::origin) the query names, exactly as `POST /jobs` is.
/// Absent — a launch from the new-run form — it leaves `job.origin` null and the run stays
/// out of every scoped halt, which is what a launch by hand should do. Present, it is what a
/// coverage plan's or ladder's dashboard sends when a reviewer triggers one of *its* cells by
/// hand: those runs were asked for by that plan, and a plan whose Halt could not reach the
/// runs its own buttons produced is a plan that visibly refuses to stop.
#[tracing::instrument(
    name = "gg.launch",
    skip(state, user, body),
    fields(case.slug = %body.test_case, case.version = %body.version),
    err(Debug),
)]
pub async fn launch_gg(
    State(state): State<AppState>,
    user: AuthUser,
    Query(query): Query<LaunchQuery>,
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
    // The configuration the launch claims to come from has to be one this account holds, and
    // it records that configuration's current name.
    if let Some(set) = launch.gg_capability_set.as_mut() {
        let names =
            launch_configuration_names(&state.db, &user.0.id, set.preset_id.as_deref()).await?;
        bind_launch_configuration(set, &names).map_err(ApiError::bad_request)?;
    }
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
    let record = super::stats::recorded_run_facts(&state).await;
    resolve_gg_model_facts(&state.db, &state.prices, &record, &mut launch)
        .await
        .map_err(ApiError::bad_request)?;
    let now = now_rfc3339()?;
    // The launching account, and whatever asked for the run: nothing for the new-run form,
    // and the plan or ladder for a cell triggered from its dashboard. Parsed by the same
    // function `POST /jobs` uses, so an origin this endpoint accepts is one a halt can sweep.
    let attribution = attribution(&user, &query)?;
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
