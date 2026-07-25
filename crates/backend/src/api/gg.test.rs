use super::*;

use crate::db::Db;

/// A launchable gg request: the `pong` case bound to the mock model on the primary
/// slot — the smallest set that a real gg session runs against.
fn sample_request() -> GgRunRequest {
    GgRunRequest {
        test_case: "pong".to_string(),
        version: "v1.0.0".to_string(),
        variant: Some("base".to_string()),
        capability_set: GgCapabilitySet::minimal("mock/echo"),
        max_runtime_seconds: None,
        retry_count: None,
    }
}

#[test]
fn into_launch_body_fixes_harness_and_lifts_primary_model() {
    // The gg-native request lowers onto a launch body with the harness fixed to gg,
    // no orchestrator, and the primary-slot model lifted into the representative
    // `model` identity — with the capability set carried through verbatim.
    let launch = sample_request()
        .into_launch_body()
        .expect("primary slot is bound");
    assert_eq!(launch.harness, HarnessSlug::Gg);
    assert_eq!(launch.model, "mock/echo");
    assert_eq!(launch.orchestrator, None);
    let set = launch
        .gg_capability_set
        .expect("the launch body carries the capability set");
    assert_eq!(set.model_for_slot(PRIMARY_SLOT), Some("mock/echo"));
}

#[test]
fn into_launch_body_requires_a_primary_slot_model() {
    // The default capability set carries the Phase 0 capabilities but binds no slot,
    // so it cannot launch: the handler rejects it with a gg-specific message.
    let req = GgRunRequest {
        capability_set: GgCapabilitySet::default(),
        ..sample_request()
    };
    let err = req.into_launch_body().unwrap_err();
    assert!(err.contains("primary"), "unexpected reason: {err}");
}

#[test]
fn into_launch_body_rejects_a_set_with_a_model_slot_left_unbound() {
    // A configuration's model slots are filled in by the launch form. One arriving
    // still deferred means the launch was incomplete — reject it here, naming the
    // role, rather than burning a container on a run gg would refuse to start.
    let mut set = GgCapabilitySet::minimal("mock/echo");
    set.model_slots = vec![test_cabinet_core::gg::GgModelSlot {
        name: "critic".to_string(),
        default_model_id: None,
        provider: None,
    }];
    set.slots
        .push(test_cabinet_core::gg::GgSlotBinding::deferred(
            "reviewer", "critic",
        ));
    let err = GgRunRequest {
        capability_set: set,
        ..sample_request()
    }
    .into_launch_body()
    .unwrap_err();
    assert!(err.contains("reviewer"), "unexpected reason: {err}");
    assert!(err.contains("unresolved"), "unexpected reason: {err}");
}

#[test]
fn build_new_job_persists_the_capability_set_for_a_gg_run() {
    // Enqueue-time job minting lifts the gg capability set out of the launch request
    // into its own column, and stamps the harness as gg.
    let launch = sample_request().into_launch_body().unwrap();
    let new = build_new_job(&launch, "2026-07-23T00:00:00Z").unwrap();
    assert_eq!(new.harness_slug, "gg");
    let json = new
        .gg_config_json
        .expect("a gg run carries a serialized capability set");
    let round: GgCapabilitySet = serde_json::from_str(&json).unwrap();
    assert_eq!(round, GgCapabilitySet::minimal("mock/echo"));
}

#[test]
fn build_new_job_leaves_gg_config_null_for_a_conventional_run() {
    // A third-party-harness launch body carries no capability set, so the column is
    // left `NULL`.
    let launch = LaunchBody {
        test_case: "pong".to_string(),
        version: "v1.0.0".to_string(),
        variant: "base".to_string(),
        harness: HarnessSlug::Claude,
        model: "claude-sonnet-4-5".to_string(),
        orchestrator: None,
        max_runtime_seconds: None,
        auth_mode: None,
        retry_count: None,
        gg_capability_set: None,
        gg_model_windows: Default::default(),
    };
    let new = build_new_job(&launch, "2026-07-23T00:00:00Z").unwrap();
    assert!(new.gg_config_json.is_none());
}

#[tokio::test]
async fn enqueue_persists_and_retrieves_the_gg_capability_set() {
    // The full enqueue substrate a gg run drains through: a job is stored with
    // harness=gg and its capability set is recoverable, both from its own column and
    // from the launch body the driver is handed on claim.
    let db = Db::connect_in_memory().await.unwrap();
    let launch = sample_request().into_launch_body().unwrap();
    let new = build_new_job(&launch, "2026-07-23T00:00:00Z").unwrap();
    let id = new.id.clone();
    db.enqueue_job(new).await.unwrap();

    let job = db.get_job(&id).await.unwrap().expect("the enqueued job");
    assert_eq!(job.harness_slug, "gg");

    // Recoverable from the first-class column...
    let stored = job
        .gg_config_json
        .expect("the gg config is persisted on the job row");
    let from_column: GgCapabilitySet = serde_json::from_str(&stored).unwrap();
    assert_eq!(from_column, sample_request().capability_set);

    // ...and the stored launch body round-trips it too, so the driver rebuilds the gg
    // run faithfully (this is what `POST /jobs/next` hands the driver).
    let claimed: LaunchBody = serde_json::from_str(&job.request_json).unwrap();
    assert_eq!(claimed.harness, HarnessSlug::Gg);
    assert_eq!(
        claimed.gg_capability_set,
        Some(sample_request().capability_set)
    );
}

// ---------------------------------------------------------------------------
// The per-model context windows pushed onto a gg launch
// ---------------------------------------------------------------------------

/// A price observation carrying `context_length` for `model_id`.
fn window_observation(model_id: &str, context_length: i64) -> crate::db::PriceWrite {
    crate::db::PriceWrite {
        model_id: model_id.to_string(),
        observed_at: "2026-01-01T00:00:00Z".to_string(),
        uncached_input: Some(1.0),
        cached_input: None,
        output: Some(2.0),
        context_length: Some(context_length),
        released_at: None,
    }
}

/// The offline price source used by these tests: an endpoint that cannot be reached, so a
/// model the catalog does not know resolves to a launch rejection without any network.
fn unreachable_prices() -> test_cabinet_core::OpenRouterPrices {
    // Port 0 is never connectable, so the fetch fails fast and deterministically.
    test_cabinet_core::OpenRouterPrices::with_endpoint("http://127.0.0.1:0/models")
}

/// Enqueuing a gg run resolves the context window of **every model it binds** from the
/// model catalog and stamps it onto the launch body, so the figure travels to the run
/// rather than being looked up from inside the run container.
#[tokio::test]
async fn launch_resolves_the_bound_models_context_windows() {
    let db = Db::connect_in_memory().await.unwrap();
    db.insert_price_observation(window_observation("anthropic/claude-opus-4.8", 200_000))
        .await
        .unwrap();
    db.insert_price_observation(window_observation("openai/gpt-5.4-mini", 400_000))
        .await
        .unwrap();

    let mut set = GgCapabilitySet::minimal("anthropic/claude-opus-4.8");
    set.slots.push(test_cabinet_core::gg::GgSlotBinding::new(
        "subagent",
        "openai/gpt-5.4-mini",
    ));
    let mut launch = GgRunRequest {
        capability_set: set,
        ..sample_request()
    }
    .into_launch_body()
    .unwrap();

    resolve_gg_model_windows(&db, &unreachable_prices(), &mut launch)
        .await
        .expect("every bound model is in the catalog");

    assert_eq!(
        launch.gg_model_windows,
        std::collections::BTreeMap::from([
            ("anthropic/claude-opus-4.8".to_string(), 200_000),
            ("openai/gpt-5.4-mini".to_string(), 400_000),
        ])
    );
}

/// A bound model whose window resolves nowhere — not in the catalog, and not from a live
/// lookup either — **rejects the launch**, naming the model. There is no default window: a
/// run measured against an assumed figure would report fullness, trigger compaction, and
/// steer the agent by a number nobody chose.
#[tokio::test]
async fn launch_is_rejected_when_a_models_window_cannot_be_resolved() {
    let db = Db::connect_in_memory().await.unwrap();
    let mut launch = sample_request().into_launch_body().unwrap();

    let err = resolve_gg_model_windows(&db, &unreachable_prices(), &mut launch)
        .await
        .expect_err("an unresolvable window is a launch failure");
    assert!(err.contains("mock/echo"), "unexpected reason: {err}");
}

/// The scripted mock provider is test-only infrastructure, not a launchable model: it is in
/// no catalog and no provider lists it, so it is rejected by the same rule as any other
/// unknown model rather than by a special case.
#[tokio::test]
async fn launch_rejects_the_scripted_mock_provider() {
    let db = Db::connect_in_memory().await.unwrap();
    let mut launch = GgRunRequest {
        capability_set: GgCapabilitySet::minimal("mock/scripted-builder"),
        ..sample_request()
    }
    .into_launch_body()
    .unwrap();

    let err = resolve_gg_model_windows(&db, &unreachable_prices(), &mut launch)
        .await
        .expect_err("a mock model cannot be launched");
    assert!(
        err.contains("mock/scripted-builder"),
        "unexpected reason: {err}"
    );
}

/// A client cannot smuggle a window in: the resolution overwrites whatever arrived, because
/// this is a backend-owned fact and not a launch input — so a client-supplied window cannot
/// buy a launch the catalog would have refused.
#[tokio::test]
async fn launch_overwrites_client_supplied_windows() {
    let db = Db::connect_in_memory().await.unwrap();
    let mut launch = sample_request().into_launch_body().unwrap();
    launch
        .gg_model_windows
        .insert("mock/echo".to_string(), 999_999);

    assert!(
        resolve_gg_model_windows(&db, &unreachable_prices(), &mut launch)
            .await
            .is_err()
    );
    assert!(launch.gg_model_windows.is_empty());
}

/// A conventional (non-gg) launch carries no capability set and so resolves nothing — the
/// windows are a gg concern only, and an unknown model never blocks a third-party-harness run.
#[tokio::test]
async fn launch_resolves_nothing_for_a_conventional_run() {
    let db = Db::connect_in_memory().await.unwrap();
    let mut launch = LaunchBody {
        test_case: "pong".to_string(),
        version: "v1.0.0".to_string(),
        variant: "base".to_string(),
        harness: HarnessSlug::Claude,
        model: "anthropic/claude-opus-4.8".to_string(),
        orchestrator: None,
        max_runtime_seconds: None,
        auth_mode: None,
        retry_count: None,
        gg_capability_set: None,
        gg_model_windows: Default::default(),
    };

    resolve_gg_model_windows(&db, &unreachable_prices(), &mut launch)
        .await
        .expect("a non-gg run resolves nothing");
    assert!(launch.gg_model_windows.is_empty());
}
